from pathlib import Path
import hashlib, json, re

R=Path(r"D:\TigerIQ\Apps\DeXCamPersonal")
S=R/"Staged_v1_0_69_TEST_310_MCP"
f=S/"smali/TigerIQProfileUpdateClick.smali"
src=f.read_text(encoding="utf-8")
assert src.count(".method public invoke()Ljava/lang/Object;")==1
before=src[:src.index(".method public invoke()Ljava/lang/Object;")]
new='''.method public invoke()Ljava/lang/Object;
    .locals 1

    sget-object v0, Lcom/ultracar/dexsplit/ui/TigerIQBridge;->sInstance:Landroid/app/Activity;
    if-nez v0, :has_activity

    invoke-static {}, Lcom/tigeriq/v44/V44UiBridge;->getActivity()Landroid/app/Activity;
    move-result-object v0
    :has_activity
    if-nez v0, :launch_update

    invoke-static {}, Lcom/tigeriq/layout/Manager;->access$600()Landroid/app/Activity;
    move-result-object v0

    :launch_update
    if-eqz v0, :done
    invoke-static {v0}, Lcom/tigeriq/v69/UpdateController;->start(Landroid/app/Activity;)V

    :done
    sget-object v0, Lld5;->a:Lld5;
    return-object v0
.end method
'''
f.write_text(before+new,encoding="utf-8")
y=S/"apktool.yml"
c=y.read_text(encoding="utf-8")
for a,b in [("versionCode: '309'","versionCode: '310'"),("versionName: 'TigerIQ_HCM_v1.0.68'","versionName: 'TigerIQ_HCM_v1.0.69'"),("apkFileName: UltraCar_v1.0.64_305_signed_TEST.apk","apkFileName: UltraCar_v1.0.69_310_unsigned_TEST.apk")]:
 assert c.count(a)==1,(a,c.count(a))
 c=c.replace(a,b)
y.write_text(c,encoding="utf-8")
assert (S/"smali/com/tigeriq/v69/UpdateController.smali").exists()
controller=(S/"smali/com/tigeriq/v69/UpdateController.smali").read_text(encoding="utf-8")
for needle in ['getPackageArchiveInfo','getApkContentsSigners','SHA-256','FileProvider','android.settings.MANAGE_UNKNOWN_APP_SOURCES','setProgress','https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/version.json']:
 assert needle in controller, ("MISSING",needle)
manifest=(S/"AndroidManifest.xml").read_text(encoding="utf-8")
assert 'android.permission.REQUEST_INSTALL_PACKAGES' in manifest
assert 'androidx.core.content.FileProvider' in manifest
print(json.dumps({"status":"V69_STAGE_PATCH_PASS","clickSHA256":hashlib.sha256(f.read_bytes()).hexdigest().upper(),"smaliCount":len(list((S/"smali/com/tigeriq/v69").glob("*.smali"))),"stage":str(S)},ensure_ascii=True))
