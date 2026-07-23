# 易标桌宠

易标投标工具箱的首版静态悬浮桌宠插件。插件显示一张透明悬浮图片，并实时展示主程序当前任务名称、进度和完成状态。

## 功能

- 透明、置顶、可拖动的静态悬浮图片
- 实时显示易标当前任务状态
- 记住上次窗口位置
- 禁用插件或关闭主程序时自动清理窗口和订阅

## 本地打包

```powershell
npm run package
```

打包结果位于 `dist/openbidkit-pet-v0.1.0.zip`。

## 本地部署

请先在易标插件管理页禁用旧版本，然后执行：

```powershell
npm run deploy:local
```

插件会部署到 `%APPDATA%\yibiao-client\plugins\openbidkit-pet`。
