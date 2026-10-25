import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Source-only checker/repair. Does not execute Apktool, install apps, or sign APKs. */
const originalInvocation = 'invoke-virtual {v11, v3, v12, v13}, Lha4;->a(Lb83;FZ)Lb83;';
const composeCall = 'Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;';

export function checkRegisterSafety(source) {
  if (!source.includes('.class public final synthetic Lzc4;') ||
      !source.includes('.locals 41') || !source.includes(originalInvocation)) {
    throw new Error('SOURCE_IDENTITY_OR_METHOD_MISMATCH');
  }
  const begin = source.indexOf(originalInvocation);
  const nextConst = source.indexOf('const v12, -0x1cd0f17e', begin);
  if (nextConst === -1) throw new Error('COMPOSE_BLOCK_END_NOT_FOUND');
  const text = source.slice(begin, nextConst);
  if ((text.match(/CardPositioned;/g) || []).length !== 2) {
    throw new Error('CARD_POSITIONED_NOT_UNIQUE');
  }
  if (!text.includes(composeCall)) throw new Error('COMPOSE_CALL_MISSING');
  if (/move-result-object v11\b/.test(text)) throw new Error('HA4_V11_CLOBBERED_WITH_STRING');
  if (!/new-instance v13, Lcom\/tigeriq\/v44\/CardPositioned;/.test(text)) throw new Error('CARD_CALLBACK_REGISTER_NOT_V13');
  if (!/invoke-direct \{v13, v12\}, Lcom\/tigeriq\/v44\/CardPositioned;-><init>\(Ljava\/lang\/String;\)V/.test(text)) throw new Error('CALLBACK_CTOR_BAD_REGISTER');
  if (!text.includes('invoke-static {v14, v13}, '+composeCall)) throw new Error('MODIFIER_CALLBACK_BAD_REGISTER');
  return true;
}

export function repairZc4(source) {
  if (!source.includes('.class public final synthetic Lzc4;') ||
      !source.includes('.method public final b(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;') ||
      !source.includes('.locals 41')) throw new Error('UNRECOGNIZED_ZC4_SOURCE');
  const marker = /(^[ \t]*invoke-virtual \{v11, v3, v12, v13\}, Lha4;->a\(Lb83;FZ\)Lb83;\s*\r?\n\s*move-result-object v14)([\s\S]*?)(?=\r?\n\s*const v12, -0x1cd0f17e)/gm;
  const all = [...source.matchAll(marker)];
  if (all.length !== 1) throw new Error('CARD_COMPOSE_ANCHOR_COUNT_' + all.length);
  const target = all[0];
  const section = target[2];
  if ((section.match(/Lcom\/tigeriq\/v44\/CardPositioned;/g)||[]).length !== 2 ||
      (section.match(/Landroidx\/compose\/ui\/layout\/a;->d\(/g)||[]).length !== 1) {
    throw new Error('NOT_EXPECTED_V44_CALLBACK_BLOCK');
  }
  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const safe = [
    '    move-object/from16 v12, p0',
    '    iget-object v12, v12, Lzc4;->b:Lta1;',
    '    invoke-virtual {v12}, Lta1;->getId()Ljava/lang/String;',
    '    move-result-object v12',
    '    new-instance v13, Lcom/tigeriq/v44/CardPositioned;',
    '    invoke-direct {v13, v12}, Lcom/tigeriq/v44/CardPositioned;-><init>(Ljava/lang/String;)V',
    '    invoke-static {v14, v13}, Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;',
    '    move-result-object v14'
  ].join(nl);
  if (section.trim().replace(/\r\n/g, '\n') === safe.trim().replace(/\r\n/g, '\n')) {
    checkRegisterSafety(source);
    return {status:'ALREADY_FIXED',content:source};
  }
  const fixed = source.slice(0, target.index) + target[1] + nl + safe + nl + source.slice(target.index+target[0].length);
  checkRegisterSafety(fixed);
  return {status:'SOURCE_PATCH_PROPOSED',content:fixed};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace('file://',''))) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('USAGE: node fix-zc4-verifier.mjs <INPUT_ZC4> <NEW_OUTPUT_ZC4>');
  if (resolve(input) === resolve(output) || existsSync(output)) throw new Error('REFUSE_OVERWRITE');
  const result = repairZc4(readFileSync(input, 'utf8'));
  writeFileSync(output, result.content, 'utf8');
  console.log(result.status);
}