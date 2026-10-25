import assert from 'node:assert/strict';
import {repairZc4,checkRegisterSafety} from './fix-zc4-verifier.mjs';
const head=[
'.class public final synthetic Lzc4;',
'.super Ljava/lang/Object;',
'.method public final b(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;',
'    .locals 41',
'    sget-object v11, Lha4;->a:Lha4;',
'    invoke-virtual {v11, v3, v12, v13}, Lha4;->a(Lb83;FZ)Lb83;',
'    move-result-object v14',''].join('\n');
const end=['','    const v12, -0x1cd0f17e','    invoke-virtual {v15, v12}, Lzo0;->W(I)V','.end method',''].join('\n');
const corrupt=[
'    move-object/from16 v11, p0',
'    iget-object v11, v11, Lzc4;->b:Lta1;',
'    invoke-virtual {v11}, Lta1;->getId()Ljava/lang/String;',
'    move-result-object v11',
'    new-instance v12, Lcom/tigeriq/v44/CardPositioned;',
'    invoke-direct {v12, v11}, Lcom/tigeriq/v44/CardPositioned;-><init>(Ljava/lang/String;)V',
'    invoke-static {v14, v12}, Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;',
'    move-result-object v14',''].join('\n');
const partial=[
'    move-object/from16 v12, p0',
'    iget-object v12, v12, Lzc4;->b:Lta1;',
'    invoke-virtual {v12}, Lta1;->getId()Ljava/lang/String;',
'    move-result-object v11',
'    new-instance v13, Lcom/tigeriq/v44/CardPositioned;',
'    invoke-direct {v12, v11}, Lcom/tigeriq/v44/CardPositioned;-><init>(Ljava/lang/String;)V',
'    invoke-static {v14, v12}, Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;',
'    move-result-object v14',''].join('\n');
const clean=[
'    move-object/from16 v12, p0',
'    iget-object v12, v12, Lzc4;->b:Lta1;',
'    invoke-virtual {v12}, Lta1;->getId()Ljava/lang/String;',
'    move-result-object v12',
'    new-instance v13, Lcom/tigeriq/v44/CardPositioned;',
'    invoke-direct {v13, v12}, Lcom/tigeriq/v44/CardPositioned;-><init>(Ljava/lang/String;)V',
'    invoke-static {v14, v13}, Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;',
'    move-result-object v14',''].join('\n');
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name);}
check('reject bad v11 receiver',()=>assert.throws(()=>checkRegisterSafety(head+corrupt+end),/HA4_V11_CLOBBERED_WITH_STRING/));
check('repair signed v44 bad callback',()=>{const r=repairZc4(head+corrupt+end);checkRegisterSafety(r.content);assert.ok(r.content.includes(clean));});
check('repair interrupted source edits',()=>{const r=repairZc4(head+partial+end);checkRegisterSafety(r.content);assert.ok(r.content.includes(clean));});
check('preserve original ha4 receiver',()=>assert.ok(repairZc4(head+partial+end).content.includes('sget-object v11, Lha4;->a:Lha4;')));
check('idempotent',()=>{const x=repairZc4(head+partial+end).content;assert.equal(repairZc4(x).status,'ALREADY_FIXED');});
check('reject unknown class',()=>assert.throws(()=>repairZc4((head+partial+end).replace('Lzc4;','Lbc4;')),/UNRECOGNIZED_ZC4_SOURCE/));
check('reject missing callback',()=>assert.throws(()=>repairZc4(head+end),/CARD_COMPOSE_ANCHOR_COUNT_0|NOT_EXPECTED_V44_CALLBACK_BLOCK/));
check('reject duplicated anchor',()=>assert.throws(()=>repairZc4(head+partial+end+head+partial+end),/CARD_COMPOSE_ANCHOR_COUNT_2/));
check('CRLF format',()=>{const x=(head+partial+end).replace(/\n/g,'\r\n');const y=repairZc4(x).content;checkRegisterSafety(y);assert.ok(y.includes('\r\n'));});
console.log('ULTRACAR_ZC4_REGRESSION_TESTS='+n);
