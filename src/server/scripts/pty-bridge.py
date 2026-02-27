"""
PTY bridge for Oboto terminal — used when node-pty is unavailable.

Spawns the requested shell inside a real pseudo-terminal so that colours,
job control, and interactive behaviour work correctly.  Data is proxied
between stdin/stdout and the PTY master file descriptor.

Usage:
    python3 pty-bridge.py /bin/zsh
"""

import pty
import sys
import os
import select
import subprocess

def main():
    try:
        master, slave = pty.openpty()

        # Spawn shell in slave PTY
        cmd = sys.argv[1:]
        if not cmd:
            cmd = [os.environ.get("SHELL", "/bin/sh")]

        # Force interactive mode for bash/zsh
        if "bash" in cmd[0] or "zsh" in cmd[0]:
            if "-i" not in cmd:
                cmd.append("-i")

        p = subprocess.Popen(
            cmd,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
            preexec_fn=os.setsid,
        )
        os.close(slave)

        # Proxy loop
        while p.poll() is None:
            r, _w, _e = select.select([sys.stdin, master], [], [], 0.1)

            # Stdin (from JS) -> PTY Master
            if sys.stdin in r:
                try:
                    d = os.read(sys.stdin.fileno(), 4096)
                    if not d:
                        break
                    os.write(master, d)
                except OSError:
                    break

            # PTY Master -> Stdout (to JS)
            if master in r:
                try:
                    d = os.read(master, 4096)
                    if not d:
                        break
                    os.write(sys.stdout.fileno(), d)
                    sys.stdout.flush()
                except OSError:
                    break

    except Exception as exc:
        sys.stderr.write(f"pty-bridge error: {exc}\n")
    finally:
        try:
            p.terminate()
            p.wait()
        except Exception:
            pass


if __name__ == "__main__":
    main()
