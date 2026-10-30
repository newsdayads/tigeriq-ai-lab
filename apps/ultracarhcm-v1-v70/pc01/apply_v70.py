from pathlib import Path
import re, json, hashlib
R=Path(r"D:\TigerIQ\Apps\DeXCamPersonal")
S=R/"Staged_v1_0_70_TEST_311_MCP"
s=S/"smali"
def replace_exact(path, old, new, reason):
    txt=path.read_text(encoding="utf-8")
    n=txt.count(old)
    if n < 1: raise RuntimeError(reason+"_ANCHORS_NOT_FOUND")
    txt=txt.replace(old,new)
    path.write_text(txt,encoding="utf-8")
    return n

saved='    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onEnterSavedScreen()V'
show='    invoke-static {}, Lcom/tigeriq/v70/LayoutSortControl;->show()V'
home='    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->onEnterHomeScreen()V'
hide='    invoke-static {}, Lcom/tigeriq/v70/LayoutSortControl;->hide()V'
a=replace_exact(s/"ad4.smali",saved,saved+"\n"+show,"SAVED_SCREEN_NAV")
b=replace_exact(s/"ho0.smali",home,home+"\n"+hide,"HOME_SCREEN_NAV")
if a!=2 or b!=2:raise RuntimeError(f"NAV_CALLER_COUNT_{a}_{b}")

bridge=s/"com/tigeriq/v44/V44UiBridge.smali"
source=bridge.read_text(encoding="utf-8")
# Existing overlay handles have incorrect touch mapping; replace with a single
# native list editor in this release, retaining Compose card layout intact.
def neutralize_method(text,method,parameters,body):
    pattern=r"(?ms)^\.method private static "+re.escape(method)+"\("+re.escape(parameters)+r"\)V\n.*?^\.end method"
    match=list(re.finditer(pattern,text))
    if len(match)!=1:raise RuntimeError("METHOD_ANCHOR_"+method+"_"+str(len(match)))
    replacement=".method private static "+method+"("+parameters+")V\n    .locals 0\n\n"+body+"\n.end method"
    return text[:match[0].start()]+replacement+text[match[0].end():]

source=neutralize_method(source,"showAllGrips","","    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->hideAllGrips()V\n    return-void")
source=neutralize_method(source,"updateGrip","Ljava/lang/String;Landroid/graphics/Rect;","    return-void")
bridge.write_text(source,encoding="utf-8")

y=S/"apktool.yml"
info=y.read_text(encoding="utf-8")
for a,b in [("versionCode: '310'","versionCode: '311'"),
             ("versionName: 'TigerIQ_HCM_v1.0.69'","versionName: 'TigerIQ_HCM_v1.0.70'"),
             ("apkFileName: UltraCar_v1.0.69_310_unsigned_TEST.apk","apkFileName: UltraCar_v1.0.70_311_unsigned_TEST.apk")]:
    if info.count(a)!=1:raise RuntimeError("VERSION_ANCHOR_"+a)
    info=info.replace(a,b)
y.write_text(info,encoding="utf-8")
layout=(s/"com/tigeriq/v70/LayoutSortControl.smali").read_text(encoding="utf-8")
for token in ['LayoutSortControl', 'Landroid/widget/TextView;']:
    if token not in layout: raise RuntimeError("CONTROL_MISSING_"+token)
all_smali="".join(p.read_text(encoding="utf-8") for p in (s/"com/tigeriq/v70").glob("*.smali"))
if "com.tigeriq.layout.Manager" not in all_smali:
    raise RuntimeError("NATIVE_MANAGER_REFERENCE_NOT_FOUND")
assert (s/"ad4.smali").read_text(encoding="utf-8").count(show)==2
assert (s/"ho0.smali").read_text(encoding="utf-8").count(hide)==2
assert 'TigerIQProfileUpdateClick' in "\n".join(f.name for f in s.glob("TigerIQProfileUpdateClick.smali"))
print(json.dumps({"status":"V70_STAGE_PATCH_PASS","savedCallers":2,"homeCallers":2,
                  "nativeControlClasses":len(list((s/"com/tigeriq/v70").glob("*.smali"))),
                  "brokenGripDisabled":True,"nativeOrderManagerPreserved":True,
                  "smaliSHA256":hashlib.sha256(bridge.read_bytes()).hexdigest().upper()},ensure_ascii=True))
