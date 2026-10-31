from pathlib import Path
import json
R=Path(r"D:\TigerIQ\Apps\DeXCamPersonal")
S=R/"Staged_v1_0_72_TEST_313_MCP"
def repl(file,old,new,n,label):
 p=S/file
 s=p.read_text(encoding="utf-8")
 c=s.count(old)
 if c!=n:raise RuntimeError(f"{label} unexpected matches: {c}, expected {n}")
 p.write_text(s.replace(old,new),encoding="utf-8")
 return c
out={}
out["profile"]=repl("res/values/strings.xml",
   "<string name=\"prof_subtitle\">TIGERIQ HCM v1.0.71 (BUILD 312)</string>",
   "<string name=\"prof_subtitle\">TIGERIQ HCM v1.0.72 (BUILD 313)</string>",1,"PROFILE")
out["sort_native_popup"]=repl("smali/ad4.smali",
   "Lcom/tigeriq/v70/LayoutSortControl;->show()V",
   "Lcom/tigeriq/v72/SortPopup;->show()V",4,"SAVED_NAV")
# Restore only the floating manual camera shortcut in app lifecycle.
# Keep the watcher and VM USB auto-opening disabled: USB present != reverse gear.
out["restore_camera_shortcut"]=repl("smali/com/ultracar/dexsplit/ui/TigerIQBridge.smali",
   "    nop    # V71: service may only be started on explicit verified reverse gear",
   "    invoke-static {p0}, Lcom/ultracar/dexsplit/ui/service/FloatingCameraService;->start(Landroid/content/Context;)V",
   2,"CAMERA_SHORTCUT_SERVICE")
b=(S/"smali/com/ultracar/dexsplit/ui/TigerIQBridge.smali").read_text(encoding="utf-8")
assert b.count("    nop    # V71: USB attachment alone must not open camera")==2
assert "R=ON broadcast ignored" in (S/"smali/com/ultracar/dexsplit/data/ReverseGearReceiver.smali").read_text(encoding="utf-8")
assert (S/"smali/com/tigeriq/v72/SortPopup.smali").exists()
assert "    nop    # V71: DeX dock is not reverse-gear input" in (S/"smali/com/ultracar/dexsplit/data/DexDockReceiver$1.smali").read_text(encoding="utf-8")
out["no_auto_usb_reverse_camera"]=True
y=S/"apktool.yml"
v=y.read_text(encoding="utf-8")
for a,z in (("versionCode: '312'","versionCode: '313'"),
            ("versionName: 'TigerIQ_HCM_v1.0.71'","versionName: 'TigerIQ_HCM_v1.0.72'"),
            ("apkFileName: UltraCar_v1.0.71_312_unsigned_TEST.apk","apkFileName: UltraCar_v1.0.72_313_unsigned_TEST.apk")):
 if v.count(a)!=1:raise RuntimeError("VERSION_ANCHOR "+a)
 v=v.replace(a,z)
y.write_text(v,encoding="utf-8")
out["version"]=313
print(json.dumps({"result":"V72_STAGE_PATCH_PASS","checks":out},ensure_ascii=True))
