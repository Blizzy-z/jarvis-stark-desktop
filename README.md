# JARVIS Stark Industries Desktop

An unofficial personal JARVIS desktop built from the OpenJarvis interface, with
Stark-inspired artwork, a phone-friendly layout and ChatGPT-plan sign-in.

## Install on Windows

Download **JARVIS-Stark-Setup-1.1.0.exe** from the
[latest release](https://github.com/Blizzy-z/jarvis-stark-desktop/releases/latest), run it, and open JARVIS.
The installer bundles Electron and all application dependencies. No separate
Node.js, npm, Python, LM Studio, GPU, or local-model download is required.
Windows x64 only. The installer is currently unsigned.

- Starts fullscreen. **F11** toggles fullscreen; **Esc** leaves it.
- Closing the window keeps JARVIS running in the system tray for phone access.
- Use the tray menu's **Quit JARVIS** to stop it.
- Choose **Continue with ChatGPT**. Sign-in opens your normal browser and then
  connects your desktop session. Select a model available to your account.

Eligible ChatGPT accounts can authorize plan usage through the documented
[Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source).
Plan limits apply. There is no automatic paid API-key fallback. Review allowances
and credit-use settings at [ChatGPT usage](https://chatgpt.com/settings/usage).

**Verification:** installer build, packaged-app launch, fullscreen/Esc/F11,
renderer isolation, and mocked sign-in/pairing/refresh/stream tests passed.
Real account authorization and subscription inference still require live testing
with the user's account. Physical microphone and playback are not yet verified.

## Phone access

Install Tailscale on the laptop and phone and connect both to your network.
The laptop must stay awake with JARVIS running. Tailscale is optional and is not
installed by the JARVIS installer.

Check `tailscale serve status` first; do not overwrite another application's port.
For a free port 8446, enable a private HTTPS address in PowerShell:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --bg --https=8446 http://127.0.0.1:3014
```

Save the exact printed HTTPS origin, without a trailing slash, in
`%LOCALAPPDATA%\JarvisStarkCloud\tailscale.json`:

```json
{"origin":"https://YOUR-LAPTOP.YOUR-TAILNET.ts.net:8446"}
```

Restart JARVIS. Open that HTTPS address on the phone. On the laptop, choose
**Create phone connection code** and enter it on the phone within ten minutes.
The code works once and grants access to that ChatGPT connection; keep it private.

No Windows autostart or power settings are modified by the installer.

## Voice and scope

Browser speech recognition works where supported and may use the browser
vendor's online service. Electron may not support it; use Windows dictation
(**Win+H**) or a phone/browser microphone instead. **Read reply** uses the device's
speech voice. This lightweight edition does not include Qwen voice cloning or an
always-on wake word. Local agents, device actions and research tools are not included.

## Privacy

OpenAI tokens remain on the host, encrypted for the Windows user with DPAPI in
`%LOCALAPPDATA%\JarvisStarkCloud\accounts.dpapi`. They are not sent to the phone.
Phone sessions use HttpOnly cookies. Chat history is stored in each browser and
is not synchronized. Disconnecting the ChatGPT connection signs out its linked
devices. Revoke access in ChatGPT Settings if needed.

No credentials, personal chats or machine-specific Tailscale address are shipped.

## Build from source

Use Windows x64, Node.js 24 and npm 11.19 or later within major version 11.

```sh
npm run setup
npm run build
npm test
npm run desktop
npm run dist
```

`setup` installs the project packages automatically. `dist` produces the Windows
installer in `releases/electron`. Development requires Node/npm; installer users
do not need them. The account vault uses Windows DPAPI.

## Credits and license

Based on [OpenJarvis](https://github.com/open-jarvis/OpenJarvis), upstream base
`68d4290663984508db94a6a59ade45c2b17859ed`, under Apache License 2.0.
Modifications add desktop packaging, mobile layout, custom artwork, browser voice,
ChatGPT-plan sign-in and phone pairing. This project is not affiliated with
OpenAI, Marvel, or the OpenJarvis maintainers. Third-party trademarks and artwork
are not relicensed by the software license.
