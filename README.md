# 虚拟试穿

独立网页小工具：摄像头实时预览 + 上传上装图片 + AI 虚拟试穿（FASHN Try-On Max）。

第一版只支持上装（T 恤、衬衫、外套），手动点击「试穿」，不做连续视频流。

## 准备工作

1. 复制环境变量模板并填写 Key：

```bash
cp .env.example .env
```

在 `.env` 中设置：

- `FASHN_API_KEY`：从 [https://fashn.ai](https://fashn.ai) 获取的 API Key  
- 或设为 `mock`：不调用真实 API，直接回显人像帧，方便调试界面  
- `PORT`：后端端口，默认 `3001`

2. 安装依赖：

```bash
cd server && npm install
cd ../client && npm install
```

## 启动

终端 A（后端）：

```bash
npm run dev --prefix server
```

终端 B（前端）：

```bash
npm run dev --prefix client
```

浏览器打开 [http://localhost:5173](http://localhost:5173)。

也可在仓库根目录执行 `npm run dev:server` / `npm run dev:client`。

## 使用步骤

1. 点击「开启摄像头」并允许权限  
2. 上传一张上装商品图  
3. 摆好姿势，点击「试穿」  
4. 等待结果；可「下载结果」或再次试穿  

## 说明

- API Key 只放在服务端 `.env`，不会进入浏览器  
- 试穿会消耗 FASHN 额度；未配置 Key 时会返回中文错误提示  
- 无 Key 时可设 `FASHN_API_KEY=mock` 演示 UI 流程  
- 图片会在前端压缩（最长边 ≤ 1280）后再上传  

## 测试

```bash
npm test --prefix server
```

## 技术栈

- 前端：Vite + React + TypeScript  
- 后端：Express（同仓库）  
- 换装：FASHN `tryon-max`
