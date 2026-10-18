# 组网方案（二选一）

家里主站 `points.example.com` 要让学生/老师在外面访问到。按家里网络情况选一种。

---

## (a) 有公网 IP：路由器端口转发 + DDNS

### 1) 确认公网 IP

```bash
curl -4 ifconfig.me
```

把这个 IP 和路由器 WAN 口状态页对比，一致才算真有公网 IP。

### 2) 路由器端口转发

进路由器后台（通常 `192.168.1.1` / `192.168.0.1`），找到「虚拟服务器 / 端口转发 / NAT」：

| 外网端口 | 内网 IP | 内网端口 | 协议 |
|---|---|---|---|
| 80 | 家里服务器内网 IP（如 192.168.1.10） | 80 | TCP |
| 443 | 家里服务器内网 IP | 443 | TCP |

> 服务器内网 IP 要在路由器里**绑定静态 DHCP**（防止重启后 IP 变）。

### 3) DDNS（家里 IP 会变）

域名 `example.com` 在 Cloudflare 托管。两种 DDNS：

- **Cloudflare 自带 DDNS**：在 Cloudflare DNS 给 `points` 加 A 记录指向家里当前公网 IP；然后在路由器里找「DDNS」插件，选 Cloudflare，填 API Token，让路由器自动更新。
- **路由器/脚本 DDNS**：常见路由器（华硕/小米/TP-Link）后台都有 DDNS 设置；选 Cloudflare，填 Global API Key 或专用 Token。
- **免费 DDNS**（如 no-ip / dynu）：把域名 CNAME 到 DDNS 域名也可。

### 4) Caddy 自动 HTTPS

DNS A 记录指向家里 IP 后，Caddy 会自动申请 Let's Encrypt 证书（80 端口必须通）。

---

## (b) 无公网 IP：Cloudflare Tunnel（推荐，最省心）

不需要公网 IP、不需要端口转发、不需要 DDNS、不需要 Caddy。

### 1) 装 cloudflared（Debian/Ubuntu）

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### 2) 登录并建隧道

```bash
cloudflared tunnel login
# 浏览器选你的域名 example.com 授权

cloudflared tunnel create class-points
# 记下输出的 TUNNEL_UUID

cloudflared tunnel route dns class-points points.example.com
```

### 3) 配置文件

把 `deploy/cloudflared-config.yml` 复制到 `/etc/cloudflared/config.yml`，把里面的 `<TUNNEL_UUID>` 换成上一步的值：

```bash
sudo mkdir -p /etc/cloudflared
sudo cp /opt/class-points/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml   # 替换 <TUNNEL_UUID>
```

### 4) 装成系统服务

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

### 5) 此时 Caddy 可省略

流量路径：学生浏览器 → Cloudflare 边缘 → tunnel → 本机 127.0.0.1:8787。
HTTPS 证书由 Cloudflare 边缘自动签发，**家里不用装 Caddy**。

---

## 验证

```bash
# 本机自检
curl -I http://127.0.0.1:8787/start

# 外网自检（手机关 Wi-Fi 用流量访问）
curl -I https://points.example.com/start
```
