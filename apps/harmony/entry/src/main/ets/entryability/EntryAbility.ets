/**
 * 应用入口（Stage 模型）。
 *
 * 职责：
 * - 加载 Index 页面（WebView 壳）；
 * - 设置全屏沉浸式与深色系统栏；
 * - 首次启动在页面加载完成后申请通知权限；
 * - 按 settings.refreshMinutes 注册 WorkScheduler 后台刷新任务。
 */

import UIAbility from '@ohos.app.ability.UIAbility';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import Want from '@ohos.app.ability.Want';
import window from '@ohos.window';
import { BusinessError } from '@ohos.base';
import { StateStore } from '../data/StateStore';
import { Notifier } from '../notify/Notifier';
import { scheduleBackgroundRefresh } from '../work/RefreshWork';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    console.info('[radar] EntryAbility onCreate');
    this.setupBackgroundWork();
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        console.error(`[radar] 页面加载失败: code=${err.code} message=${err.message}`);
        return;
      }
      // requestEnableNotification 必须在 loadContent 成功之后调用
      Notifier.ensureEnabled(this.context).catch((notifyError: Object): void => {
        const error = notifyError as BusinessError;
        console.warn(`[radar] 通知授权流程失败: ${error.message}`);
      });
    });

    windowStage
      .getMainWindow()
      .then((mainWindow: window.Window) => {
        mainWindow.setWindowLayoutFullScreen(true).catch((err: BusinessError) => {
          console.warn(`[radar] 设置全屏失败: ${err.message}`);
        });
        // setWindowBackgroundColor 是同步接口
        try {
          mainWindow.setWindowBackgroundColor('#0a0e13');
        } catch (bgError) {
          const error = bgError as BusinessError;
          console.warn(`[radar] 设置窗口背景失败: ${error.message}`);
        }
        const properties: window.SystemBarProperties = {
          statusBarColor: '#0a0e13',
          navigationBarColor: '#0a0e13',
          statusBarContentColor: '#ffffff',
          navigationBarContentColor: '#ffffff'
        };
        mainWindow.setWindowSystemBarProperties(properties).catch((err: BusinessError) => {
          console.warn(`[radar] 设置系统栏颜色失败: ${err.message}`);
        });
      })
      .catch((err: BusinessError) => {
        console.warn(`[radar] 获取主窗口失败: ${err.message}`);
      });
  }

  onWindowStageDestroy(): void {
    console.info('[radar] EntryAbility onWindowStageDestroy');
  }

  onForeground(): void {
    // 前台自动刷新由 Index -> NativeBridge.onForeground() 判断数据是否过期后触发，
    // 避免 Ability 与 WebView 各自持有一份引擎实例。
    console.info('[radar] EntryAbility onForeground');
  }

  onBackground(): void {
    console.info('[radar] EntryAbility onBackground');
  }

  onDestroy(): void {
    console.info('[radar] EntryAbility onDestroy');
  }

  /** 读取已保存的刷新间隔并注册后台任务 */
  private async setupBackgroundWork(): Promise<void> {
    try {
      const store = new StateStore(this.context);
      await store.init();
      scheduleBackgroundRefresh(store.settings.refreshMinutes);
    } catch (err) {
      const error = err as BusinessError;
      console.error(`[radar] 初始化后台任务失败: ${error.message}`);
      // 即使读取设置失败，也用默认 60 分钟注册一次，保证后台提醒可用
      scheduleBackgroundRefresh(60);
    }
  }
}
