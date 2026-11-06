"""Read-only UI acceptance of the exact retained 0.1.5 APK on a disposable emulator.
No broker credentials, test prices, app internals or backend mutations.
"""
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path('evidence')
OUT.mkdir(exist_ok=True)

def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=20, text=True)

def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/capsule-window.xml')
    xml = adb('shell', 'cat', '/sdcard/capsule-window.xml')
    return ET.fromstring(xml)

def labels(root):
    return [n.get('text', '') for n in root.iter('node') if n.get('text')]

def wait_for(predicate, seconds=60):
    deadline = time.monotonic() + seconds
    last = []
    while time.monotonic() < deadline:
        root = tree()
        last = labels(root)
        if predicate(last):
            return root
        time.sleep(1)
    raise AssertionError('UI condition timed out: ' + json.dumps(last, ensure_ascii=False))

def click(text):
    root = tree()
    matches = [n for n in root.iter('node') if n.get('text') == text or n.get('content-desc') == text]
    if not matches:
        raise AssertionError('Control absent: ' + text)
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', matches[0].get('bounds')))
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))

def capture(name):
    root = tree()
    (OUT / (name + '.xml')).write_text(ET.tostring(root, encoding='unicode'))
    with (OUT / (name + '.png')).open('wb') as file:
        subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True, timeout=20)
    return labels(root)

def current(texts):
    return 'RECENT STREAM SNAPSHOT' in texts and any(x.startswith('₹') and x != '₹—' for x in texts)

def scroll_to(text):
    for _ in range(6):
        if any(text in x for x in labels(tree())):
            return
        adb('shell', 'input', 'swipe', '540', '1500', '540', '600', '350')
    raise AssertionError('Panel absent: ' + text)

try:
    adb('shell', 'am', 'start', '-W', '-n', 'com.marketcapsule.app/.MainActivity')
    wait_for(lambda xs: 'Start updates' in xs)
    click('Start updates')
    wait_for(current, 90)
    first = capture('01-nifty-live')
    times = [x for x in first if x.startswith('Server time:')]
    # Prove subsequent frames are rendered rather than one unchanged snapshot.
    wait_for(lambda xs: current(xs) and [x for x in xs if x.startswith('Server time:')] != times, 30)
    capture('02-nifty-next-frame')
    click('SENSEX')
    wait_for(lambda xs: current(xs) and 'SENSEX · snapshot' in xs)
    capture('03-sensex-live')
    click('Live Desk')
    scroll_to('Expiry 2026-')
    # A LazyColumn heading may enter the viewport before its card's premium cells.
    scroll_to('Recent quote')
    wait_for(lambda xs: any(x.startswith('Expiry 2026-') for x in xs) and 'Recent quote' in xs, 45)
    capture('04-native-expiry-card')
    # Return to the quote header before taking away only the emulator network.
    click('Today')
    for _ in range(6):
        if 'RECENT STREAM SNAPSHOT' in labels(tree()):
            break
        adb('shell', 'input', 'swipe', '540', '600', '540', '1500', '300')
    wait_for(current)
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable')
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    wait_for(lambda xs: 'RECENT STREAM SNAPSHOT' not in xs, 30)
    capture('05-offline-withdrawal')
    # Reconnect uses the existing wanted mode; do not force-stop or restart the app.
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable')
    adb('shell', 'svc', 'wifi', 'enable')
    adb('shell', 'svc', 'data', 'enable')
    wait_for(current, 120)
    capture('06-real-network-recovery')
    click('Stop updates')
    wait_for(lambda xs: 'Updates off' in xs)
    capture('07-updates-stopped')
    (OUT / 'result.json').write_text(json.dumps({'passed': True, 'apkVersion': '0.1.5',
        'scope': 'Android 15 emulator; real read-only production connection, advancing frames, index switch, native expiry card, network loss and recovery',
        'physicalPhoneAccepted': False}, indent=2))
except Exception as error:
    (OUT / 'result.json').write_text(json.dumps({'passed': False, 'error': str(error)}, indent=2))
    try:
        capture('failure')
    except Exception:
        pass
    raise
