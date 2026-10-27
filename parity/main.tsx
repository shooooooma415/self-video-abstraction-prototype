import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Condition = 'hidden' | 'real' | 'avatar'
type Answer = 'same' | 'different'
type Stimulus = { id: string; left: number; right: number; word: string; correct: Answer }
type TrialLog = { participant_id: string; session_id: string; goal_condition: string; display_condition: string; display_order_index: number; block_index: number; trial_index_in_block: number; trial_index_in_condition: number; stimulus_id: string; stimulus_seed: number; left_number: number; right_number: number; word: string; correct_answer: Answer; response: Answer; is_correct: boolean; reaction_time_ms: number; status: 'completed'; stimulus_onset_timestamp: string }
type Session = { participantId: string; id: string; seed: number; goal: 'speed' | 'accuracy'; order: Condition[]; trials: TrialLog[]; questionnaires: Record<string, Record<string, number>>; events: Record<string, string>[]; startedAt: string }
const ORDERINGS: Condition[][] = [['hidden','real','avatar'],['hidden','avatar','real'],['real','hidden','avatar'],['real','avatar','hidden'],['avatar','hidden','real'],['avatar','real','hidden']]
const names: Record<Condition, string> = { hidden: '非表示', real: '実写映像', avatar: 'アバター' }
const words = ['JACKET','WINDOW','GARDEN','PENCIL','PLANET','BOTTLE','MARKET','RABBIT','POCKET','CANDLE','BRIDGE','ORANGE','CAMERA','FLOWER','BUTTON','TICKET']
const totalTrials = 96
const blankQuestionnaire = () => ({ self_private_1:0,self_private_2:0,self_private_3:0,self_public_1:0,self_public_2:0,self_public_3:0, surroundings_1:0,surroundings_2:0,surroundings_3:0 })
function makeStimuli(seed: number, condition: Condition, practice = false): Stimulus[] {
  let state = (seed ^ (condition.charCodeAt(0) * 2654435761) ^ (practice ? 0x51f15e : 0)) >>> 0
  const rand = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296 }
  const count = practice ? 8 : totalTrials
  const list: Stimulus[] = []
  for (let i=0; i<count; i++) {
    const same = practice ? i < 4 : i % 16 < 8
    const left = 1 + Math.floor(rand()*9)
    let right = 1 + Math.floor(rand()*9)
    while (right === left || ((left % 2 === right % 2) !== same)) right = 1 + Math.floor(rand()*9)
    list.push({ id: `${condition}-${practice?'P': 'T'}${String(i+1).padStart(3,'0')}`, left, right, word: words[Math.floor(rand()*words.length)], correct: same ? 'same':'different' })
  }
  // Shuffle within each block, retaining exactly eight items per answer type.
  for (let start=0; start<count; start+=16) for(let i=Math.min(start+15,count-1); i>start; i--) { const j=start+Math.floor(rand()*(i-start+1)); [list[i],list[j]]=[list[j],list[i]] }
  return list
}
function download(name: string, text: string, type: string) { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href) }
function csv(rows: Record<string, unknown>[]) { if (!rows.length) return ''; const keys=Object.keys(rows[0]); const quote=(v: unknown)=>`"${String(v ?? '').replaceAll('"','""')}"`; return [keys.map(quote).join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\r\n') }
function App() {
  const [screen,setScreen]=React.useState<'setup'|'intro'|'task'|'break'|'survey'|'finish'>('setup')
  const [participant,setParticipant]=React.useState('')
  const [goal,setGoal]=React.useState<'speed'|'accuracy'>('speed')
  const [orderIndex,setOrderIndex]=React.useState(0)
  const [consent,setConsent]=React.useState(false)
  const [session,setSession]=React.useState<Session|null>(null)
  const [stage,setStage]=React.useState<'pre'|'fixation'|'stimulus'|'feedback'>('pre')
  const [conditionIndex,setConditionIndex]=React.useState(0)
  const [practice,setPractice]=React.useState(true)
  const [trialIndex,setTrialIndex]=React.useState(0)
  const [stimulus,setStimulus]=React.useState<Stimulus|null>(null)
  const [message,setMessage]=React.useState('')
  const [lastCorrect,setLastCorrect]=React.useState(false)
  const onset=React.useRef(0)
  const started=React.useRef('')
  const clock=React.useRef<number[]>([])
  const sessionRef=React.useRef<Session|null>(null)
  const condition=session?.order[conditionIndex] ?? 'hidden'
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
  React.useEffect(()=>{ const visibility=()=>{const s=sessionRef.current;if(!s)return;setSession(x=>x?({...x,events:[...x.events,{event:document.hidden?'page_hidden':'page_visible',timestamp:new Date().toISOString(),condition:s.order[conditionIndex]}]}):x)};const blur=()=>{const s=sessionRef.current;if(s)setSession(x=>x?({...x,events:[...x.events,{event:'window_blur',timestamp:new Date().toISOString(),condition:s.order[conditionIndex]}]}):x)};document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur)} },[conditionIndex])
  const start=()=>{if(!participant.trim()||!consent)return;const seed=crypto.getRandomValues(new Uint32Array(1))[0];const s:Session={participantId:participant.trim(),id:crypto.randomUUID(),seed,goal,order:ORDERINGS[orderIndex],trials:[],questionnaires:{},events:[],startedAt:new Date().toISOString()};setSession(s);setConditionIndex(0);setPractice(true);setTrialIndex(0);setScreen('intro')}
  const respond=(answer:Answer)=>{if(stage!=='stimulus'||!stimulus||!session)return;const rt=performance.now()-onset.current;const correct=answer===stimulus.correct;setLastCorrect(correct);if(practice){setMessage(correct?'正解です。':'不正解です。');setStage('feedback');window.setTimeout(()=>{setTrialIndex(i=>i+1)},650)}else{const block=Math.floor(trialIndex/16)+1;const log:TrialLog={participant_id:session.participantId,session_id:session.id,goal_condition:session.goal,display_condition:condition,display_order_index:conditionIndex+1,block_index:block,trial_index_in_block:trialIndex%16+1,trial_index_in_condition:trialIndex+1,stimulus_id:stimulus.id,stimulus_seed:session.seed,left_number:stimulus.left,right_number:stimulus.right,word:stimulus.word,correct_answer:stimulus.correct,response:answer,is_correct:correct,reaction_time_ms:Number(rt.toFixed(1)),status:'completed',stimulus_onset_timestamp:started.current};setSession(s=>s?({...s,trials:[...s.trials,log]}):s);setTrialIndex(i=>i+1)}}
  React.useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.repeat)return;if(e.key.toLowerCase()==='f')respond('same');if(e.key.toLowerCase()==='j')respond('different')};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)})
  const beginTrials=()=>{setMessage('');setScreen('task');setTrialIndex(0)}
  const saveQuestionnaire=()=>{if(!session)return;const data:Record<string,number>={...blankQuestionnaire()};document.querySelectorAll<HTMLInputElement>('[data-q]').forEach(input=>{data[input.dataset.q!]=Number(input.value)});setSession(s=>s?({...s,questionnaires:{...s.questionnaires,[condition]:data}}):s);if(conditionIndex<2){setConditionIndex(i=>i+1);setPractice(false);setScreen('intro')}else setScreen('finish')}
  const downloadAll=()=>{
    if(!session)return
    const prefix=`${session.participantId}_${session.id}`
    download(`${prefix}_trials.csv`,csv(session.trials as unknown as Record<string,unknown>[]),'text/csv;charset=utf-8')
    const questionnaires=Object.entries(session.questionnaires).map(([display_condition,answers])=>({participant_id:session.participantId,session_id:session.id,display_condition,...answers}))
    download(`${prefix}_questionnaires.csv`,csv(questionnaires),'text/csv;charset=utf-8')
    download(`${prefix}_sessions.csv`,csv([{participant_id:session.participantId,session_id:session.id,goal_condition:session.goal,display_order:session.order.join('>'),stimulus_seed:session.seed,started_at:session.startedAt,user_agent:navigator.userAgent,screen:`${window.screen.width}x${window.screen.height}`}]),'text/csv;charset=utf-8')
    download(`${prefix}_events.csv`,csv(session.events as unknown as Record<string,unknown>[]),'text/csv;charset=utf-8')
    download(`${prefix}_experiment.json`,JSON.stringify({session,config:{practiceTrials:8,blocksPerCondition:6,trialsPerBlock:16,preTrialDelayMs:1000,fixationMs:250,displayConditions:['hidden','real','avatar'],goalConditions:['speed','accuracy']}},null,2),'application/json')
  }
  const reset=()=>{localStorage.removeItem('parity-experiment-session');setSession(null);setScreen('setup')}
  return <div className="app"><header><a className="brand" href="#" onClick={e=>e.preventDefault()}>PARITY LAB <span>実験システム</span></a><span className="local"><i/>端末内に自動保存</span></header>
  {screen==='setup'&&<main className="setup"><div className="intro"><div className="eyebrow">BEHAVIORAL TASK · LOCAL SESSION</div><h1>偶奇判定課題</h1><p>左右の数字の偶奇が同じか異なるかを、中央の英単語を無視して判断します。</p><div className="info"><b>実験者向け</b><p>カメラシステムは別タブ・別サーバーで起動します。各条件の開始前にカメラタブで表示条件を合わせ、実写・アバターは小窓表示にしてください。</p></div></div><section className="card"><label>参加者ID<input value={participant} onChange={e=>setParticipant(e.target.value)} placeholder="例: P001"/></label><fieldset><legend>目標条件</legend><label className="choice"><input type="radio" checked={goal==='speed'} onChange={()=>setGoal('speed')}/>速度重視</label><label className="choice"><input type="radio" checked={goal==='accuracy'} onChange={()=>setGoal('accuracy')}/>正確性重視</label><p className="hint">参加者内では固定されます。</p></fieldset><label>表示条件の順序<select value={orderIndex} onChange={e=>setOrderIndex(Number(e.target.value))}>{ORDERINGS.map((o,i)=><option value={i} key={i}>{i+1}: {o.map(x=>names[x]).join(' → ')}</option>)}</select></label><label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>説明を受け、参加に同意します。</label><button className="primary" disabled={!participant.trim()||!consent} onClick={start}>セッションを開始 <span>→</span></button><p className="hint">全3条件・288試行と練習8試行。データはこのブラウザーに保存されます。</p></section></main>}
  {screen==='intro'&&<main className="panel"><div className="eyebrow">{practice?'PRACTICE':'CONDITION'} {practice?'':'0'+(conditionIndex+1)}</div><h1>{practice?'練習を始めます':`${names[condition]}条件`}</h1><p>{session?.goal==='speed'?'できるだけ速く回答してください。多少の間違いは構いません。正確性よりも速さを優先してください。':'できるだけ正確に回答してください。多少時間がかかっても構いません。速さよりも正確性を優先してください。'}</p><div className="instruction">左の数字と右の数字の<strong>偶奇</strong>が同じなら <kbd>F</kbd>、異なるなら <kbd>J</kbd> を押してください。中央の英単語は無視してください。<p>画面中央に「＋」が表示された後、問題が表示されます。回答するまで問題は消えません。</p></div>{!practice&&<div className="condition-note"><b>表示条件を合わせてください</b><p>カメラシステムの別タブで「{names[condition]}」を選択し、必要な場合は小窓を表示した状態で戻ってください。</p></div>}{message&&<p>{message}</p>}<button className="primary" onClick={beginTrials}>{practice?'練習開始':'課題開始'} <span>→</span></button></main>}
  {screen==='task'&&<main className="task"><div className="taskmeta"><span>{practice?'練習':`${names[condition]} · ブロック ${Math.floor(trialIndex/16)+1}/6`}</span><span>{trialIndex+1} / {stimuli.length}</span></div><div className="stimulus">{stage==='fixation'?'+':stage==='stimulus'||stage==='feedback'?<><b>{stimulus?.left}</b><span>{stimulus?.word}</span><b>{stimulus?.right}</b></>:null}</div>{stage==='stimulus'&&<div className="keys"><span><kbd>F</kbd> 同じ偶奇</span><span><kbd>J</kbd> 異なる偶奇</span></div>}{stage==='feedback'&&<p className={lastCorrect?'correct':'wrong'}>{message}</p>}</main>}
  {screen==='break'&&<main className="panel"><div className="eyebrow">BLOCK COMPLETE</div><h1>{names[condition]}条件の課題終了</h1><p>この条件の96試行が保存されました。次に質問紙へ進んでください。</p><button className="primary" onClick={()=>setScreen('survey')}>質問紙へ <span>→</span></button></main>}
  {screen==='survey'&&<main className="panel survey"><div className="eyebrow">QUESTIONNAIRE · {names[condition]}</div><h1>作業中の感じ方</h1><p>この条件で課題に取り組んだときの感覚について回答してください。1（まったく当てはまらない）〜7（非常に当てはまる）</p><div className="notice">ここに表示する9項目は研究用SSAS正式項目ではありません。実験でSSASを測定する場合は、利用条件を確認した正式な設問に差し替えてください。</div>{['自分自身の考えや感情に注意を向けていた','自分の外見や振る舞いを意識していた','周囲の環境に注意を向けていた','自分の行動が他者からどう見えるか意識していた','課題中、自分自身について考えていた','周囲で起きていることに気づいていた','自分の内面の状態に気づいていた','自分の振る舞いを気にしていた','作業環境に意識が向いていた'].map((q,i)=><label className="qrow" key={i}><span>{i+1}. {q}</span><input data-q={Object.keys(blankQuestionnaire())[i]} type="range" min="1" max="7" defaultValue="4"/><small>1 ─ 7</small></label>)}{condition!=='hidden'&&['表示された顔を自分自身の表現だと感じた','表示された顔が自分に似ていると感じた','表示された顔の動きが自分の動きと一致していると感じた','表示によって作業中に気が散った'].map((q,i)=><label className="qrow" key={q}><span>{q}</span><input data-q={`exploratory_${i+1}`} type="range" min="1" max="7" defaultValue="4"/><small>1 ─ 7</small></label>)}<button className="primary" onClick={saveQuestionnaire}>{conditionIndex<2?'次の条件へ':'終了画面へ'} <span>→</span></button></main>}
  {screen==='finish'&&<main className="panel"><div className="eyebrow">SESSION COMPLETE</div><h1>セッションが終了しました</h1><p>回答 {session?.trials.length ?? 0} 試行を自動保存しました。下のボタンから記録を出力してください。</p><div className="stats"><span>参加者ID<b>{session?.participantId}</b></span><span>セッションID<b>{session?.id}</b></span><span>目標条件<b>{session?.goal==='speed'?'速度重視':'正確性重視'}</b></span></div><button className="primary" onClick={downloadAll}>CSV・JSONをダウンロード <span>↓</span></button><button className="secondary" onClick={reset}>新しいセッション</button></main>}
  <footer>偶奇判定課題 <span>研究用プロトタイプ · データはこの端末内で管理</span></footer></div>
}
createRoot(document.getElementById('root')!).render(<App />)
