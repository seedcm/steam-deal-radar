#!/usr/bin/env bash
# 把 Steam 折扣雷达安装到当前用户目录（不需要 sudo）。
#
#   bash scripts/install-linux.sh                  # 自动使用 release/ 下最新的 AppImage
#   bash scripts/install-linux.sh /path/to.AppImage
#   bash scripts/install-linux.sh --uninstall
#
# 之所以解包而不是直接复制 AppImage：Arch / Omarchy 默认没有 libfuse.so.2，
# 解包后由桌面启动器直接执行 AppRun，既不需要 FUSE，启动也更快。
set -euo pipefail

APP_ID="steam-deal-radar"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
PREFIX="$DATA_HOME/$APP_ID"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m警告:\033[0m %s\n' "$*"; }
die() { printf '\033[31m错误:\033[0m %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$PREFIX"
  rm -f "$BIN_DIR/$APP_ID" "$DESKTOP_DIR/$APP_ID.desktop" "$ICON_DIR/$APP_ID.png"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
  info "已卸载 Steam 折扣雷达（本地数据仍保留在 ~/.config/Steam 折扣雷达）"
  exit 0
fi

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE="$(ls -1 "$REPO_ROOT"/release/*.AppImage 2>/dev/null | sort | tail -n 1 || true)"
fi
[ -n "$APPIMAGE" ] && [ -f "$APPIMAGE" ] || die "找不到 AppImage。先运行 npm run dist:linux，或把 AppImage 路径作为参数传入。"

# 转成绝对路径：解包时要先 cd 到临时目录，相对路径会失效
APPIMAGE="$(cd "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE")"

info "解包 $APPIMAGE"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 先解到临时目录，成功后再替换旧版本；解包失败不会破坏现有安装
(
  cd "$TMP_DIR"
  # 不依赖 FUSE：AppImage 自带解包模式
  "$APPIMAGE" --appimage-extract >/dev/null 2>&1
) || die "解包失败，确认这是一个 Electron AppImage"
[ -x "$TMP_DIR/squashfs-root/AppRun" ] || die "解包后没有找到 AppRun"

rm -rf "$PREFIX"
mkdir -p "$PREFIX"
shopt -s dotglob nullglob
mv "$TMP_DIR"/squashfs-root/* "$PREFIX"/
shopt -u dotglob nullglob
[ -x "$PREFIX/AppRun" ] || die "安装目录里没有 AppRun"

mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"

ICON_SRC="$(find "$PREFIX" -path '*icons*' -name "$APP_ID.png" -print -quit 2>/dev/null || true)"
if [ -n "$ICON_SRC" ] && [ -f "$ICON_SRC" ]; then
  cp -f "$ICON_SRC" "$ICON_DIR/$APP_ID.png"
  ICON_VALUE="$ICON_DIR/$APP_ID.png"
else
  ICON_VALUE="$APP_ID"
fi

cat > "$DESKTOP_DIR/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Steam 折扣雷达
Name[en]=Steam Deal Radar
Comment=追踪 Steam 折扣，到价时提醒你
Exec="$PREFIX/AppRun" %U
Icon=$ICON_VALUE
Terminal=false
Categories=Utility;Game;
StartupWMClass=$APP_ID
EOF
chmod 644 "$DESKTOP_DIR/$APP_ID.desktop"

ln -sfn "$PREFIX/AppRun" "$BIN_DIR/$APP_ID"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

info "安装完成"
echo
echo "  启动方式一：在应用启动器里搜索「Steam 折扣雷达」"
echo "  启动方式二：终端执行 $APP_ID"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR 不在 PATH 里，可以直接运行 $PREFIX/AppRun，或把下面一行加到 ~/.bashrc："
     echo '       export PATH="$HOME/.local/bin:$PATH"' ;;
esac
echo
echo "  程序目录：$PREFIX"
echo "  数据目录：$HOME/.config/Steam 折扣雷达"
echo "  卸载：    bash scripts/install-linux.sh --uninstall"
