/**
 * 鸿蒙端唯一页面：WebView 壳。
 *
 * 前端构建产物由仓库根目录的 scripts/sync-harmony.mjs 复制到
 * entry/src/main/resources/rawfile/web/ 下，这里通过 $rawfile('web/index.html') 加载。
 *
 * javaScriptProxy 放在 Web 组件初始化属性上（而不是 onPageEnd 里），
 * 这样 window.nativeBridge 在页面自己的 module script 执行前就已注入；
 * onPageEnd 负责标记页面就绪、补发启动阶段缓存的事件并触发过期自动刷新。
 */

import webview from '@ohos.web.webview';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@ohos.base';
import { NativeBridge } from '../bridge/NativeBridge';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: NativeBridge = new NativeBridge();

  aboutToAppear(): void {
    const context = getContext(this) as common.UIAbilityContext;
    this.bridge.attach(context, this.controller);
  }

  aboutToDisappear(): void {
    // 按 javaScriptProxy 文档建议，页面销毁时移除注入对象，避免内存泄漏
    try {
      this.controller.deleteJavaScriptRegister('nativeBridge');
    } catch (err) {
      const error = err as BusinessError;
      console.warn(`[radar] 移除 JS 桥失败: ${error.message}`);
    }
  }

  build() {
    Stack() {
      Web({ src: $rawfile('web/index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .onlineImageAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: 'nativeBridge',
          methodList: ['invoke', 'platform', 'version'],
          controller: this.controller
        })
        .onPageBegin(() => {
          this.bridge.onPageBegin();
        })
        .onPageEnd(() => {
          this.bridge.onPageReady(this.controller);
        })
        .backgroundColor('#0a0e13')
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0a0e13')
    // 全屏沉浸式：背景与内容延伸到状态栏/导航栏区域
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }

  /**
   * 返回键优先交给 WebView 的历史栈（详情抽屉由前端自行关闭）。
   * 没有可回退的页面时返回 false，交给系统默认行为（回到桌面）。
   */
  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (err) {
      const error = err as BusinessError;
      console.warn(`[radar] WebView 返回失败: ${error.message}`);
    }
    return false;
  }

  onPageShow(): void {
    // 从后台回到前台时检查数据是否超过 refreshMinutes
    this.bridge.onForeground();
  }
}
