"""V71 saved-layout post-render native sort control hook.
Run once after apply_v71.py and before apktool build.
"""
from pathlib import Path
S = Path(r"D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_71_TEST_312_MCP")
p = S / "smali/ad4.smali"
s = p.read_text(encoding="utf-8")
show = "    invoke-static {}, Lcom/tigeriq/v70/LayoutSortControl;->show()V"
calls = [
    "    invoke-static/range {v4 .. v14}, Lyu2;->e(Lwx2;Lnz1;Lnz1;Lnz1;Lnz1;Lrz1;Lnz1;Lmz1;Lb83;Luo0;I)V",
    "    invoke-static/range {v15 .. v25}, Lyu2;->e(Lwx2;Lnz1;Lnz1;Lnz1;Lnz1;Lrz1;Lnz1;Lmz1;Lb83;Luo0;I)V",
]
for call in calls:
    if s.count(call) != 1:
        raise RuntimeError("UNEXPECTED_SAVED_LAYOUT_COMPOSE_CALL")
    after = call + "\n" + show
    if after not in s:
        s = s.replace(call, after)
if s.count(show) != 4:
    raise RuntimeError(f"EXPECTED_4_SHOW_HOOKS_GOT_{s.count(show)}")
if "versionCode: '312'" not in (S / "apktool.yml").read_text(encoding="utf-8"):
    raise RuntimeError("NOT_V71_STAGE")
p.write_text(s, encoding="utf-8")
print("V71_POST_RENDER_SORT_CONTROL_PASS")
