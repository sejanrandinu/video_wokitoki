# How to Deploy to Cloudflare (The Easy Way)

Since your App now has a **Built-in Frontend + Backend**, you can host it on Cloudflare in 2 minutes.

### Method 1: Cloudflare Tunnel (Recommended)
This makes your computer act as a server, securely accessible via a Cloudflare URL.

1. Install Cloudflare's tunnel tool (`cloudflared`).
2. Run this command in your terminal:
   ```cmd
   cloudflared tunnel --url http://localhost:3001
   ```
3. Cloudflare will give you a link (e.g., `https://random-name.trycloudflare.com`). **That's it! Your App is live.**

### Method 2: Cloudflare Pages + Render (Pro Way)
If you want it to run even when your computer is off:
1. **Backend**: Upload the `server` folder to [Render.com](https://render.com) (FREE).
2. **Frontend**: Upload the `dist` folder to **Cloudflare Pages**.
3. I have already configured the code to detect where it is running, so it will connect automatically.

---
**Current Status:**
- Frontend: Built (in `dist` folder)
- Backend: Running on Port 3001
- All-in-one: Yes (Server serves the UI)

To run it locally any time:
`node server/server.js`
