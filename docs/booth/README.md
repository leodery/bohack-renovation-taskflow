# BoHack 2026 · 共序·港乡

**20 字内简介**　让装修变更可核对、可确认、可执行

## 评审入口

- [扫码体验同款网页](https://leoder.tail57564b.ts.net/?show=1)，用左侧「切换身份」进入住户、设计师或施工方页面。
- [四分钟路演操作稿](四分钟路演.md) · [海报二维码 SVG](demo-qr.svg) · [二维码 PNG](demo-qr.png)
- 展台链接随演示主机在线可用。离线于展台时，也可下载仓库并运行本机版。首次安装 Python 依赖需要网络。

## 本机复现

1. 安装 Python 3.11 或更新版本，下载完整仓库。
2. Windows 双击仓库根目录的 `start-demo.cmd`。安装完成后打开 [本机演示](http://127.0.0.1:8775/)。
3. 用左侧「切换身份」选住户或施工方，从正在执行的方案发起变更。新浏览器会话可重新体验。

## 恢复海报上的公网入口

1. 在原 Tailscale 演示主机更新仓库，关闭占用 8775 端口的旧演示窗口，双击 `start-public-demo.cmd` 并保持窗口运行。脚本使用独立的 `instance/booth-public-demo` 数据目录。
2. 在管理员终端运行 `tailscale funnel status`，核对 `leoder.tail57564b.ts.net` 的 HTTPS 入口是否转发至 `http://127.0.0.1:8775`。仅当原主机上的转发缺失或目标错误时，运行 `tailscale funnel --bg http://127.0.0.1:8775` 并再次核对域名。
3. 用手机移动网络打开原海报链接，确认能进入演示并切换身份。公网模式要求原域名和 HTTPS，直接访问本机地址会返回 403。

## 建议评审的三步

1. **发起变更**。住户修改需求，或施工方上报材料无法到货。可一键填入示例。
2. **三方确认**。设计师和施工方对照原方案核对可行性，住户最后确认。三方确认同一版本后，新方案生效。
3. **现场照片**。施工方可上传[厨房墙砖样片](../../demo-assets/kitchen/)，供住户和设计师查看。确认期间也可上传作为协商依据。

案例数据、角色及照片均为演示素材。AI 转述需要配置云端或本机模型，原文始终可查。

## 技术与复现

后端使用 Python、Flask、Waitress 和 SQLite。图片使用 Pillow 解析，前端使用原生 HTML、CSS 与 JavaScript。依赖版本见 [requirements.txt](../../requirements.txt)。施工照片检查依据见 [PHOTO_STANDARDS.md](../../PHOTO_STANDARDS.md)。

赛前已有代码及现场新增内容请以参赛队在官方平台的申报和[仓库提交记录](https://github.com/leodery/bohack-renovation-taskflow/commits/main/)为准。
