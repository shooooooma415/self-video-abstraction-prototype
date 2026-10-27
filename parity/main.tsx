import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Condition = 'hidden' | 'real' | 'avatar'
type Answer = 'same' | 'different'
type Stimulus = { id: string; left: number; right: number; word: string; correct: Answer }
type TrialLog = { participant_id: string; session_id: string; goal_condition: string; display_condition: string; block_index: number; trial_index_in_block: number; trial_index_in_condition: number; stimulus_id: string; stimulus_seed: number; left_number: number; right_number: number; word: string; correct_answer: Answer; response: Answer; is_correct: boolean; reaction_time_ms: number; status: 'completed'; stimulus_onset_timestamp: string }
type Session = { participantId: string; id: string; seed: number; goal: 'speed' | 'accuracy'; displayCondition: Condition; practiceEnabled: boolean; trials: TrialLog[]; events: Record<string, string>[]; startedAt: string }
const names: Record<Condition, string> = { hidden: '非表示', real: '実写映像', avatar: 'アバター' }
const words = ['JACKET','WINDOW','GARDEN','PENCIL','PLANET','BOTTLE','MARKET','RABBIT','POCKET','CANDLE','BRIDGE','ORANGE','CAMERA','FLOWER','BUTTON','TICKET']
const blocksPerCondition = 6
const trialsPerBlock = 16
const totalTrials = blocksPerCondition * trialsPerBlock
function makeStimuli(seed: number, condition: Condition, practice = false): Stimulus[] {
  let state = (seed ^ (condition.charCodeAt(0) * 2654435761) ^ (practice ? 0x51f15e : 0)) >>> 0
  const rand = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296 }
  const count = practice ? 8 : totalTrials
  const list: Stimulus[] = []
  for (let i=0; i<count; i++) {
    const same = practice ? i < 4 : i % trialsPerBlock < trialsPerBlock / 2
    const left = 1 + Math.floor(rand()*9)
    let right = 1 + Math.floor(rand()*9)
    while (right === left || ((left % 2 === right % 2) !== same)) right = 1 + Math.floor(rand()*9)
    list.push({ id: `${condition}-${practice?'P': 'T'}${String(i+1).padStart(3,'0')}`, left, right, word: words[Math.floor(rand()*words.length)], correct: same ? 'same':'different' })
  }
  // Shuffle within each block while retaining an equal number of each answer type.
  const blockSize = practice ? count : trialsPerBlock
  for (let start=0; start<count; start+=blockSize) for(let i=Math.min(start+blockSize-1,count-1); i>start; i--) { const j=start+Math.floor(rand()*(i-start+1)); [list[i],list[j]]=[list[j],list[i]] }
  return list
}
function download(name: string, text: string, type: string) { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href) }
function csv(rows: Record<string, unknown>[]) { if (!rows.length) return ''; const keys=Object.keys(rows[0]); const quote=(v: unknown)=>`"${String(v ?? '').replaceAll('"','""')}"`; return [keys.map(quote).join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\r\n') }
function App() {
  const [screen,setScreen]=React.useState<'setup'|'intro'|'task'|'break'|'finish'>('setup')
  const [participant,setParticipant]=React.useState('')
  const [goal,setGoal]=React.useState<'speed'|'accuracy'>('speed')
  const [displayCondition,setDisplayCondition]=React.useState<Condition>('hidden')
  const [practiceEnabled,setPracticeEnabled]=React.useState(true)
  const [consent,setConsent]=React.useState(false)
  const [session,setSession]=React.useState<Session|null>(null)
  const [stage,setStage]=React.useState<'pre'|'fixation'|'stimulus'|'feedback'>('pre')
  const [practice,setPractice]=React.useState(true)
  const [trialIndex,setTrialIndex]=React.useState(0)
  const [stimulus,setStimulus]=React.useState<Stimulus|null>(null)
  const [message,setMessage]=React.useState('')
  const [lastCorrect,setLastCorrect]=React.useState(false)
  const onset=React.useRef(0)
  const started=React.useRef('')
  const clock=React.useRef<number[]>([])
  const sessionRef=React.useRef<Session|null>(null)
  const condition=session?.displayCondition ?? displayCondition
  const stimuli=React.useMemo(()=>session?makeStimuli(session.seed,condition,practice):[],[session?.seed,condition,practice])
  React.useEffect(()=>{ sessionRef.current=session; if(session) localStorage.setItem('parity-experiment-session',JSON.stringify(session)) },[session])
  React.useEffect(()=>{
    if(screen!=='task') return
    if(trialIndex>=stimuli.length) { if(practice){setPractice(false);setTrialIndex(0);setMessage('練習は終了です。本番では正誤フィードバックは表示されません。');setScreen('intro')} else setScreen('break'); return }
    setStage('pre');setStimulus(null)
    const a=window.setTimeout(()=>{setStage('fixation');const b=window.setTimeout(()=>{setStimulus(stimuli[trialIndex]);onset.current=performance.now();started.current=new Date().toISOString();setStage('stimulus')},250);clock.current.push(b)},1000)
    clock.current.push(a)
    return()=>clock.current.forEach(window.clearTimeout)
  },[screen,trialIndex,stimuli,practice])
  React.useEffect(()=>{ const visibility=()=>{const s=sessionRef.current;if(!s)return;setSession(x=>x?({...x,events:[...x.events,{event:document.hidden?'page_hidden':'page_visible',timestamp:new Date().toISOString(),condition:s.displayCondition}]}):x)};const blur=()=>{const s=sessionRef.current;if(s)setSession(x=>x?({...x,events:[...x.events,{event:'window_blur',timestamp:new Date().toISOString(),condition:s.displayCondition}]}):x)};document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur)} },[])
  const start=()=>{if(!participant.trim()||!consent)return;const seed=crypto.getRandomValues(new Uint32Array(1))[0];const s:Session={participantId:participant.trim(),id:crypto.randomUUID(),seed,goal,displayCondition,practiceEnabled,trials:[],events:[],startedAt:new Date().toISOString()};setSession(s);setPractice(practiceEnabled);setTrialIndex(0);setScreen('intro')}
  const respond=(answer:Answer)=>{if(stage!=='stimulus'||!stimulus||!session)return;const rt=performance.now()-onset.current;const correct=answer===stimulus.correct;setLastCorrect(correct);if(practice){setMessage(correct?'正解です。':'不正解です。');setStage('feedback');window.setTimeout(()=>{setTrialIndex(i=>i+1)},650)}else{const block=Math.floor(trialIndex/trialsPerBlock)+1;const log:TrialLog={participant_id:session.participantId,session_id:session.id,goal_condition:session.goal,display_condition:condition,block_index:block,trial_index_in_block:trialIndex%trialsPerBlock+1,trial_index_in_condition:trialIndex+1,stimulus_id:stimulus.id,stimulus_seed:session.seed,left_number:stimulus.left,right_number:stimulus.right,word:stimulus.word,correct_answer:stimulus.correct,response:answer,is_correct:correct,reaction_time_ms:Number(rt.toFixed(1)),status:'completed',stimulus_onset_timestamp:started.current};setSession(s=>s?({...s,trials:[...s.trials,log]}):s);setTrialIndex(i=>i+1)}}
  React.useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.repeat)return;if(e.key.toLowerCase()==='f')respond('same');if(e.key.toLowerCase()==='j')respond('different')};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)})
  const beginTrials=()=>{setMessage('');setScreen('task');setTrialIndex(0)}
  const downloadAll=()=>{
    if(!session)return
    const prefix=`${session.participantId}_${session.id}`
    download(`${prefix}_trials.csv`,csv(session.trials as unknown as Record<string,unknown>[]),'text/csv;charset=utf-8')
    download(`${prefix}_sessions.csv`,csv([{participant_id:session.participantId,session_id:session.id,goal_condition:session.goal,display_condition:session.displayCondition,practice_enabled:session.practiceEnabled,practice_trial_count:session.practiceEnabled?8:0,stimulus_seed:session.seed,started_at:session.startedAt,user_agent:navigator.userAgent,screen:`${window.screen.width}x${window.screen.height}`}]),'text/csv;charset=utf-8')
    download(`${prefix}_events.csv`,csv(session.events as unknown as Record<string,unknown>[]),'text/csv;charset=utf-8')
    download(`${prefix}_experiment.json`,JSON.stringify({session,config:{practiceTrials:session.practiceEnabled?8:0,blocksPerCondition,trialsPerBlock,preTrialDelayMs:1000,fixationMs:250,displayConditions:['hidden','real','avatar'],goalConditions:['speed','accuracy']}},null,2),'application/json')
  }
  const reset=()=>{localStorage.removeItem('parity-experiment-session');setSession(null);setScreen('setup')}
  return <div className="app"><header><a className="brand" href="#" onClick={e=>e.preventDefault()}>PARITY LAB <span>実験システム</span></a><span className="local"><i/>端末内に自動保存</span></header>
  {screen==='setup'&&<main className="setup"><div className="intro"><div className="eyebrow">BEHAVIORAL TASK · LOCAL SESSION</div><h1>偶奇判定課題</h1><p>左右の数字の偶奇が同じか異なるかを、中央の英単語を無視して判断します。</p><div className="info"><b>実験者向け</b><p>1セッションにつき表示条件を1つ実施します。カメラシステムは別タブ・別サーバーで起動し、実写・アバター条件では小窓表示にしてください。</p></div></div><section className="card"><label>参加者ID<input value={participant} onChange={e=>setParticipant(e.target.value)} placeholder="例: P001"/></label><fieldset><legend>目標条件</legend><label className="choice"><input type="radio" checked={goal==='speed'} onChange={()=>setGoal('speed')}/>速度重視</label><label className="choice"><input type="radio" checked={goal==='accuracy'} onChange={()=>setGoal('accuracy')}/>正確性重視</label><p className="hint">参加者に割り当てた目標条件を、各セッションで同じにしてください。</p></fieldset><label>今回の表示条件<select value={displayCondition} onChange={e=>setDisplayCondition(e.target.value as Condition)}>{(['hidden','real','avatar'] as Condition[]).map(item=><option value={item} key={item}>{names[item]}</option>)}</select></label><fieldset><legend>練習試行</legend><label className="choice"><input type="radio" checked={practiceEnabled} onChange={()=>setPracticeEnabled(true)}/>あり（8問）</label><label className="choice"><input type="radio" checked={!practiceEnabled} onChange={()=>setPracticeEnabled(false)}/>なし</label><p className="hint">練習の正誤フィードバックは練習中のみ表示されます。</p></fieldset><label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>説明を受け、参加に同意します。</label><button className="primary" disabled={!participant.trim()||!consent} onClick={start}>この条件のセッションを開始 <span>→</span></button><p className="hint">本番は96試行です。データはこのブラウザーに保存されます。</p></section></main>}
  {screen==='intro'&&<main className="panel"><div className="eyebrow">{practice?'PRACTICE':'SESSION'}</div><h1>{practice?'練習を始めます':`${names[condition]}条件`}</h1><p>{session?.goal==='speed'?'できるだけ速く回答してください。多少の間違いは構いません。正確性よりも速さを優先してください。':'できるだけ正確に回答してください。多少時間がかかっても構いません。速さよりも正確性を優先してください。'}</p><div className="instruction">左の数字と右の数字の<strong>偶奇</strong>が同じなら <kbd>F</kbd>、異なるなら <kbd>J</kbd> を押してください。中央の英単語は無視してください。<p>画面中央に「＋」が表示された後、問題が表示されます。回答するまで問題は消えません。</p></div>{!practice&&<div className="condition-note"><b>表示条件を合わせてください</b><p>カメラシステムの別タブで「{names[condition]}」を選択し、必要な場合は小窓を表示した状態で戻ってください。</p></div>}{message&&<p>{message}</p>}<button className="primary" onClick={beginTrials}>{practice?'練習開始':'課題開始'} <span>→</span></button></main>}
  {screen==='task'&&<main className="task"><div className="taskmeta"><span>{practice?'練習':`${names[condition]} · ブロック ${Math.floor(trialIndex/trialsPerBlock)+1}/${blocksPerCondition}`}</span><span>{trialIndex+1} / {stimuli.length}</span></div><div className="stimulus">{stage==='fixation'?'+':stage==='stimulus'||stage==='feedback'?<><b>{stimulus?.left}</b><span>{stimulus?.word}</span><b>{stimulus?.right}</b></>:null}</div>{stage==='stimulus'&&<div className="keys"><span><kbd>F</kbd> 同じ偶奇</span><span><kbd>J</kbd> 異なる偶奇</span></div>}{stage==='feedback'&&<p className={lastCorrect?'correct':'wrong'}>{message}</p>}</main>}
  {screen==='break'&&<main className="panel"><div className="eyebrow">CONDITION COMPLETE</div><h1>{names[condition]}条件の課題終了</h1><p>この条件の96試行が保存されました。</p><button className="primary" onClick={()=>setScreen('finish')}>結果を確認して終了 <span>→</span></button></main>}
  {screen==='finish'&&<main className="panel"><div className="eyebrow">SESSION COMPLETE</div><h1>セッションが終了しました</h1><p>回答 {session?.trials.length ?? 0} 試行を自動保存しました。下のボタンから記録を出力してください。</p><div className="stats"><span>参加者ID<b>{session?.participantId}</b></span><span>セッションID<b>{session?.id}</b></span><span>目標条件<b>{session?.goal==='speed'?'速度重視':'正確性重視'}</b></span></div><button className="primary" onClick={downloadAll}>CSV・JSONをダウンロード <span>↓</span></button><button className="secondary" onClick={reset}>新しいセッション</button></main>}
  <footer>偶奇判定課題 <span>研究用プロトタイプ · データはこの端末内で管理</span></footer></div>
}
createRoot(document.getElementById('root')!).render(<App />)
