from pathlib import Path
import re,json
R=Path(r"D:\TigerIQ\Apps\DeXCamPersonal")
S=R/"Staged_v1_0_73_TEST_314_MCP"
def patch(path,old,new,count,label):
 p=S/path
 txt=p.read_text(encoding="utf-8")
 actual=txt.count(old)
 if actual!=count:raise RuntimeError(label+f" expected {count} got {actual}")
 p.write_text(txt.replace(old,new),encoding="utf-8")
 return actual
report={}
report["sort_arm"]=patch("smali/ad4.smali",
   "Lcom/tigeriq/v72/SortPopup;->show()V",
   "Lcom/tigeriq/v73/LayoutReorderEntry;->arm()V",4,"SORT_ARM")
report["on_list_ready"]=patch("smali/bd4.smali",
   "    invoke-static {v1}, Lcom/tigeriq/layout/Manager;->sort(Ljava/util/List;)Ljava/util/List;\n\n    move-result-object v1",
   "    invoke-static {v1}, Lcom/tigeriq/layout/Manager;->sort(Ljava/util/List;)Ljava/util/List;\n\n    move-result-object v1\n\n    invoke-static {}, Lcom/tigeriq/v73/LayoutReorderEntry;->listReady()V",1,"NATIVE_MANAGER_LIST_READY")
report["reset_on_home"]=patch("smali/ho0.smali",
   "    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onEnterHomeScreen()V",
   "    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onEnterHomeScreen()V\n    invoke-static {}, Lcom/tigeriq/v73/LayoutReorderEntry;->reset()V",
   2,"HOME_RESET")
# IMPORTANT: floating button already has camera symbol in its fallback
# Canvas vector. Always draw this branch, never the unrelated provided drawable.
f=S/"smali/com/ultracar/dexsplit/ui/service/FloatingCameraService$1.smali"
text=f.read_text(encoding="utf-8")
start=text.index(".method protected onDraw(Landroid/graphics/Canvas;)V")
end=text.index(".end method",start)
chunk=text[start:end]
old="    if-eqz v2, :cond_1"
if chunk.count(old)!=1:raise RuntimeError("ICON_DRAWABLE_BRANCH_MISMATCH")
chunk=chunk.replace(old,"    goto :cond_1")
f.write_text(text[:start]+chunk+text[end:],encoding="utf-8")
report["camera_vector_forced"]=True
report["profile"]=patch("res/values/strings.xml",
 '<string name="prof_subtitle">TIGERIQ HCM v1.0.72 (BUILD 313)</string>',
 '<string name="prof_subtitle">TIGERIQ HCM v1.0.73 (BUILD 314)</string>',1,"PROFILE")
y=S/"apktool.yml"
v=y.read_text(encoding="utf-8")
for old,new in [
 ("versionCode: '313'","versionCode: '314'"),
 ("versionName: 'TigerIQ_HCM_v1.0.72'","versionName: 'TigerIQ_HCM_v1.0.73'"),
 ("apkFileName: UltraCar_v1.0.72_313_unsigned_TEST.apk","apkFileName: UltraCar_v1.0.73_314_unsigned_TEST.apk")
]:
 if v.count(old)!=1:raise RuntimeError("YAML_VERSION_ANCHOR")
 v=v.replace(old,new)
y.write_text(v,encoding="utf-8")
assert (S/"smali/com/tigeriq/v73/LayoutReorderEntry.smali").is_file()
assert "R=ON broadcast ignored: physical gear signal unverified" in (S/"smali/com/ultracar/dexsplit/data/ReverseGearReceiver.smali").read_text()
report["physical_r_gate_preserved"]=True
print(json.dumps({"status":"V73_PATCH_PASS","checks":report}))
