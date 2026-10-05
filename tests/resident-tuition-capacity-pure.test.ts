import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResidentTeacherCapacity, validateResidentTuitionPolicy, type ResidentEducationLesson } from '../src/simulation/resident-education.ts';

// Pure synthetic interval/header boundaries, not a simulated money/credential
// positive. A game actor is never created, funded, moved or awarded here.
const lesson=(startAt:number,endAt:number):ResidentEducationLesson=>({teacherId:'teacher',teacherRole:'老师',teacherWorkId:'school',startAt,endAt,paidStartAt:startAt,paidEndAt:endAt,arrivalStartAt:startAt,arrivalEndAt:endAt,observedTick:1});
const course=(start=600,end=660,pointId='classroom')=>({siteId:'school',pointId,lessons:[lesson(start,end)]});
test('exact native lesson source capacity allows four simultaneous seats and rejects a fifth or another room',()=>{
  assert.doesNotThrow(()=>validateResidentTeacherCapacity(Array.from({length:4},()=>course())));
  assert.throws(()=>validateResidentTeacherCapacity(Array.from({length:5},()=>course())),/四席/);
  assert.throws(()=>validateResidentTeacherCapacity([course(),course(600,660,'other-room')]),/同室/);
  assert.doesNotThrow(()=>validateResidentTeacherCapacity([course(600,630),course(630,660,'other-room')]));
});
test('orphan adult sources, one-sided policy and wrong body-marker manifest pairs cannot silently enable legacy',()=>{
  const empty={version:2,state:{},runtime:{}};assert.doesNotThrow(()=>validateResidentTuitionPolicy(empty));
  for(const data of [
    {version:2,state:{family:{formalLearningVersion:3}},runtime:{}},
    {version:2,state:{family:{formalLearning:{actor:{residentTuitionPages:[]}}}},runtime:{}},
    {version:4,motionVersion:2,historyPolicyId:'civic-history-pages-v1',residentTuitionPolicyId:'resident-formal-tuition-v1',state:{},runtime:{}},
    {version:4,motionVersion:2,historyPolicyId:'civic-history-pages-v1',residentTuitionPolicyId:'resident-formal-tuition-v1',state:{residentEducation:{version:1}},runtime:{residentTuitionPolicyId:'resident-formal-tuition-v1'}},
  ])assert.throws(()=>validateResidentTuitionPolicy(data),/政策/);
});
