---
title: Wokitoki
emoji: 📻
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# Video Walkie-Talkie App
This app provides video call and walkie-talkie functionality using React, Socket.io, and WebRTC.

## Global Connectivity (Anywhere in the World)
To make this app work across different networks (not just the same WiFi):
1. **Host on HTTPS**: Use Hugging Face, Cloudflare Pages, or any HTTPS enabled hosting. WebRTC requires HTTPS for camera/mic access.
2. **STUN/TURN Servers**: I've included several public STUN servers. For 100% reliability on mobile networks, add a TURN server in `src/components/WalkieTalkie.jsx`. You can get a free TURN server from services like [Metered.ca](https://www.metered.ca/) or [Xirsys](https://xirsys.com/).
3. **Public URL**: Ensure everyone connects using the same public URL (e.g., your-app.hf.space).

