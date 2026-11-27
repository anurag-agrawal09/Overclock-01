import os
import sys
import time
import webbrowser
import subprocess

def run_project():
    print("=" * 60)
    print(" BLOOD DONOR FINDER & EMERGENCY REQUEST BOARD (SW-11)")
    print("=" * 60)
    print("[1/3] Initializing Database if present...")

    root_dir = os.path.dirname(os.path.abspath(__file__))
    db_file = os.path.join(root_dir, "database", "db.py")
    if os.path.exists(db_file):
        try:
            sys.path.insert(0, root_dir)
            from database.db import init_db
            init_db()
            print("      Database initialized successfully.")
        except Exception as e:
            print(f"      (Database will initialize when Member 3 merges: {e})")
    else:
        print("      (Database module pending Member 3 branch merge).")

    print("[2/3] Starting Backend Server on http://127.0.0.1:5000 ...")
    backend_script = os.path.join(root_dir, "backend", "app.py")
    proc = subprocess.Popen([sys.executable, backend_script])

    # Give server 1.5 seconds to wake up
    time.sleep(1.5)

    print("[3/3] Opening Frontend in your web browser...")
    frontend_file = os.path.join(root_dir, "frontend", "index.html")
    if os.path.exists(frontend_file):
        webbrowser.open("file://" + os.path.abspath(frontend_file))
    else:
        print("      frontend/index.html will open once Member 2 commits it!")

    print("\nPress Ctrl + C in this terminal to stop the server.")
    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping server...")
        proc.terminate()

if __name__ == "__main__":
    run_project()
