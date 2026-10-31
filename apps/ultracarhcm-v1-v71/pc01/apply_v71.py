from pathlib import Path
import re, json, hashlib
R=Path(r'D:\TigerIQ\Apps\DeXCamPersonal')
P=R/'patch_v71_mcp'
S=R/'Staged_v1_0_71_TEST_312_MCP'
assert S.exists(), 'V71_STAGE_NOT_READY'

def swap(f, old, new, count, tag):
    p=S/f
    text=p.read_text(encoding='utf-8')
    n=text.count(old)
    if n!=count: raise RuntimeError(f'{tag}: expected {count}, got {n}')
    p.write_text(text.replace(old,new),encoding='utf-8')
    return n
evidence={}
evidence['profileSubtitle']=swap('res/values/strings.xml',
    '<string name="prof_subtitle">TIGERIQ HCM v1.0.66 (BUILD 307)</string>',
    '<string name="prof_subtitle">TIGERIQ HCM v1.0.71 (BUILD 312)</string>',1,'PROFILE_VERSION')
evidence['homeFalseHideRemoved']=swap('smali/ho0.smali',
    '    invoke-static {}, Lcom/tigeriq/v70/LayoutSortControl;->hide()V\n','',2,'REMOVE_FALSE_HOME_HIDE')
a=(S/'smali/ad4.smali').read_text(encoding='utf-8')
if a.count('Lcom/tigeriq/v70/LayoutSortControl;->show()V')!=2:
    raise RuntimeError('SAVED_SCREEN_SHOW_CALL_COUNT')
evidence['savedScreenShowPaths']=2
# USB presence is NOT physical reverse-gear proof.
# On app init/resume, never start a floating camera service or USB watcher.
bridge='smali/com/ultracar/dexsplit/ui/TigerIQBridge.smali'
evidence['bridgeServiceAutostartRemoved']=swap(bridge,
   '    invoke-static {p0}, Lcom/ultracar/dexsplit/ui/service/FloatingCameraService;->start(Landroid/content/Context;)V',
   '    nop    # V71: service may only be started on explicit verified reverse gear',
   2,'BRIDGE_AUTO_SERVICE')
evidence['bridgeWatcherAutostartRemoved']=swap(bridge,
   '    invoke-static {}, Lcom/ultracar/dexsplit/ui/TigerIQBridge;->startWatcher()V',
   '    nop    # V71: USB attachment alone must not open camera',
   2,'BRIDGE_AUTO_WATCHER')
evidence['dockAutoServiceRemoved']=swap('smali/com/ultracar/dexsplit/data/DexDockReceiver$1.smali',
   '    invoke-static {v0}, Lcom/ultracar/dexsplit/ui/service/FloatingCameraService;->start(Landroid/content/Context;)V',
   '    nop    # V71: DeX dock is not reverse-gear input',
   1,'DEX_DOCK_AUTO_SERVICE')
av=S/'smali/av1.smali'
txt=av.read_text(encoding='utf-8')
needle='    invoke-virtual {v0, v9}, Ldm4;->n(Ljava/lang/Object;)Z'
if txt.count('camera_auto_open_edge')!=1 or txt.count(needle)!=1:
    raise RuntimeError('VM_CAMERA_AUTO_OPEN_ANCHOR')
i=txt.index('camera_auto_open_edge');j=txt.index(needle)
if not 0<j-i<1300:raise RuntimeError('VM_AUTO_OPEN_CONTEXT_NOT_VALID')
av.write_text(txt.replace(needle,
    '    nop    # V71: USB device attached does NOT imply reverse gear'),encoding='utf-8')
evidence['vmUsbEdgeAutoOpenDisabled']=True
# ReverseGearReceiver intentionally remains fail-closed until actual
# hardware reverse-gear feed is independently verified.
receiver=(S/'smali/com/ultracar/dexsplit/data/ReverseGearReceiver.smali').read_text(encoding='utf-8')
assert 'R=ON broadcast ignored: physical gear signal unverified' in receiver
evidence['unverifiedReverseSignalStillBlocked']=True
y=S/'apktool.yml'
text=y.read_text(encoding='utf-8')
for old,new in [("versionCode: '311'","versionCode: '312'"),
                ("versionName: 'TigerIQ_HCM_v1.0.70'","versionName: 'TigerIQ_HCM_v1.0.71'"),
                ("apkFileName: UltraCar_v1.0.70_311_unsigned_TEST.apk","apkFileName: UltraCar_v1.0.71_312_unsigned_TEST.apk")]:
    if text.count(old)!=1:raise RuntimeError('APKTOOL_VERSION_ANCHOR_'+old)
    text=text.replace(old,new)
y.write_text(text,encoding='utf-8')
evidence['buildCode']=312
print(json.dumps(evidence,ensure_ascii=True))
