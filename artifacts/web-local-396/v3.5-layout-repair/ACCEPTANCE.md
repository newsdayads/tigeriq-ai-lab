## V3.5 acceptance gates

Code/CI gates:
- exactly one sidebar DOM block after final transform;
- V3.5 final runtime marker present;
- lower-grid placement: Team full width, System left, Owner right, Rights full width;
- system cards compact and responsive;
- system labels must not collapse to character-by-character wrapping;
- technical system descriptions hidden from Overview but remain available in dedicated System view;
- existing Fluent Executive visual/data contract preserved.

Machine-real final gate:
- PC01 updater installs exact release SHA;
- `http://100.97.23.87:8787` health/UI HTTP 200;
- no giant lower-grid whitespace;
- no broken/vertical system text;
- no duplicated DOM sidebar;
- owner confirms screenshot/layout visually acceptable.
