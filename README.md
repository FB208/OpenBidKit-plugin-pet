# 易标桌宠

易标投标工具箱的动画悬浮桌宠插件。插件通过平滑的状态动画实时展示主程序当前任务名称、进度和完成状态。

## 功能

- 透明、置顶、可拖动的动画桌宠
- 关键帧间按屏幕刷新率平滑补间
- 实时显示易标当前任务状态
- 记住上次窗口位置
- 禁用插件或关闭主程序时自动清理窗口和订阅

## 本地打包

```powershell
npm run package
```

打包结果位于 `dist/openbidkit-pet-v0.2.0.zip`。

也可以指定要写入发布包清单的版本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package.ps1 -Version 0.2.0
```

## 发布新版本

发布版本使用 `vX.Y.Z` 格式的 Git Tag。Tag 推送到 GitHub 后，Actions 会自动：

1. 校验 Tag 版本格式。
2. 将版本号和 Release 下载地址写入发布包内的 `manifest.json`。
3. 生成 `openbidkit-pet-vX.Y.Z.zip`。
4. 创建同名正式 Release 并上传 ZIP。

```powershell
git tag v0.2.0
git push origin v0.2.0
```

仓库工作区中的 `manifest.json` 不会被工作流回写，安装包内的版本信息以 Tag 为准。

## 本地部署

请先在易标插件管理页禁用旧版本，然后执行：

```powershell
npm run deploy:local
```

插件会部署到 `%APPDATA%\yibiao-client\plugins\openbidkit-pet`。
