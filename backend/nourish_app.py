"""Launcher for Nourish.exe (also works as `python nourish_app.py`).

Starts the server, opens the app in the browser, and prints the address to use on a phone.
Close the window to stop Nourish.
"""
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
# Inside the .exe, the web files are unpacked to a temp folder (sys._MEIPASS).
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
# Settings (.env), the log and any data live next to the .exe.
DATA_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
PORT = int(os.getenv("NOURISH_PORT", "8000"))


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def pause_before_exit():
    # When double-clicked, the console window would vanish before the message could be read.
    if FROZEN:
        try:
            input("\nPress Enter to close this window...")
        except EOFError:
            pass


def main():
    os.environ.setdefault("FRONTEND_DIR", str(BUNDLE_DIR / "frontend" if FROZEN else BUNDLE_DIR))
    os.environ.setdefault("NOURISH_PORT", str(PORT))
    os.chdir(DATA_DIR)
    local_url = f"http://localhost:{PORT}"
    open_browser = os.getenv("NOURISH_NO_BROWSER") != "1"

    if port_in_use(PORT):
        print(f"Something is already using port {PORT} - Nourish is probably already running.")
        print(f"Opening {local_url} ...")
        if open_browser:
            webbrowser.open(local_url)
        pause_before_exit()
        return

    import uvicorn
    from main import app, lan_urls, VERSION

    print("=" * 60)
    print(f"  Nourish {VERSION} is running. Keep this window open.")
    print(f"  On this PC:     {local_url}")
    for url in lan_urls():
        print(f"  On your phone:  {url}   (same Wi-Fi)")
    print("  Close this window to stop Nourish.")
    print("=" * 60)
    if open_browser:
        threading.Thread(target=lambda: (time.sleep(1.5), webbrowser.open(local_url)), daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        pause_before_exit()
        sys.exit(1)
