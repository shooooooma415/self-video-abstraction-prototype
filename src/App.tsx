import { useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import './prototype.css'

type Condition = 'hidden' | 'original' | 'avatar'
const labels: Record<Condition, string> = { hidden: '非表示', original: '実写', avatar: '顔アバター' }
const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
const faceModelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

function drawAvatarFace(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], shapes: { categoryName: string; score: number }[], width: number, height: number) {
  if (points.length < 478) return
  const xy = (index: number) => ({ x: points[index].x * width, y: points[index].y * height })
  const score = (name: string) => shapes.find(shape => shape.categoryName === name)?.score ?? 0
  const eyes: [number, number, number][] = [[33, 133, 468], [362, 263, 473]]
  ctx.save()
  const cheekA = xy(234), cheekB = xy(454), forehead = xy(10), chin = xy(152)
  const headCenter = { x: (cheekA.x + cheekB.x) / 2, y: (forehead.y + chin.y) / 2 }
  const headRx = Math.max(9, Math.hypot(cheekB.x - cheekA.x, cheekB.y - cheekA.y) * 0.61)
  const headRy = Math.max(12, Math.abs(chin.y - forehead.y) * 0.59)
  ctx.shadowColor = '#43312c66'
  ctx.shadowBlur = headRx * 0.16
  ctx.shadowOffsetY = headRy * 0.045
  const skinGradient = ctx.createLinearGradient(headCenter.x - headRx, headCenter.y - headRy, headCenter.x + headRx, headCenter.y + headRy)
  skinGradient.addColorStop(0, '#f0c4a5')
  skinGradient.addColorStop(0.42, '#dfad8d')
  skinGradient.addColorStop(1, '#bb8167')
  ctx.fillStyle = skinGradient
  ctx.beginPath()
  ctx.ellipse(headCenter.x, headCenter.y, headRx, headRy, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  const hairGradient = ctx.createLinearGradient(headCenter.x, headCenter.y - headRy, headCenter.x, headCenter.y - headRy * 0.05)
  hairGradient.addColorStop(0, '#756054')
  hairGradient.addColorStop(0.52, '#493b35')
  hairGradient.addColorStop(1, '#302b29')
  ctx.fillStyle = hairGradient
  ctx.beginPath()
  ctx.ellipse(headCenter.x, headCenter.y - headRy * 0.67, headRx * 1.04, headRy * 0.48, 0, Math.PI, Math.PI * 2)
  ctx.lineTo(headCenter.x + headRx * 0.98, headCenter.y - headRy * 0.2)
  ctx.quadraticCurveTo(headCenter.x + headRx * 0.6, headCenter.y - headRy * 0.46, headCenter.x + headRx * 0.28, headCenter.y - headRy * 0.42)
  ctx.quadraticCurveTo(headCenter.x, headCenter.y - headRy * 0.58, headCenter.x - headRx * 0.28, headCenter.y - headRy * 0.42)
  ctx.quadraticCurveTo(headCenter.x - headRx * 0.7, headCenter.y - headRy * 0.48, headCenter.x - headRx, headCenter.y - headRy * 0.18)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = skinGradient
  for (const cheek of [cheekA, cheekB]) {
    ctx.beginPath()
    ctx.arc(cheek.x, cheek.y, headRx * 0.14, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#f5f3e9'
  ctx.strokeStyle = '#f5f3e9'
  for (const [cornerA, cornerB, irisIndex] of eyes) {
    const a = xy(cornerA), b = xy(cornerB), iris = xy(irisIndex)
    const eyeWidth = Math.hypot(b.x - a.x, b.y - a.y)
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const blinkName = cornerA === 33 ? 'eyeBlinkLeft' : 'eyeBlinkRight'
    const openness = 1 - Math.min(1, score(blinkName))
    const eyeHeight = Math.max(1.2, eyeWidth * (0.28 * openness + 0.035))
    ctx.shadowColor = '#39292055'
    ctx.shadowBlur = eyeWidth * 0.12
    ctx.strokeStyle = '#503b34'
    ctx.lineWidth = Math.max(1.3, eyeWidth * 0.075)
    ctx.beginPath()
    ctx.moveTo(center.x - eyeWidth * 0.48, center.y - eyeHeight * 1.2)
    ctx.quadraticCurveTo(center.x, center.y - eyeHeight * 2.1, center.x + eyeWidth * 0.48, center.y - eyeHeight * 1.2)
    ctx.stroke()
    ctx.strokeStyle = '#f5f3e9'
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, eyeWidth * 0.48, eyeHeight, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    if (openness > 0.18) {
      const pupilX = center.x + Math.max(-eyeWidth * 0.16, Math.min(eyeWidth * 0.16, iris.x - center.x))
      const pupilY = center.y + Math.max(-eyeHeight * 0.25, Math.min(eyeHeight * 0.25, iris.y - center.y))
      ctx.fillStyle = '#262a26'
      ctx.beginPath()
      ctx.arc(pupilX, pupilY, Math.max(1.4, eyeWidth * 0.13), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f5f3e9'
    }
  }
  const nose = xy(1), noseLeft = xy(98), noseRight = xy(327)
  const noseWidth = Math.max(2, Math.hypot(noseRight.x - noseLeft.x, noseRight.y - noseLeft.y) * 0.18)
  const noseGradient = ctx.createLinearGradient(nose.x - noseWidth, nose.y, nose.x + noseWidth, nose.y + noseWidth * 1.8)
  noseGradient.addColorStop(0, '#c58d70')
  noseGradient.addColorStop(0.5, '#edbd9d')
  noseGradient.addColorStop(1, '#b87d64')
  ctx.fillStyle = noseGradient
  ctx.beginPath()
  ctx.ellipse(nose.x, nose.y + noseWidth * 0.75, noseWidth, noseWidth * 1.5, 0, 0, Math.PI * 2)
  ctx.fill()
  const mouthLeft = xy(61), mouthRight = xy(291), upperLip = xy(13), lowerLip = xy(14)
  const mouthWidth = Math.hypot(mouthRight.x - mouthLeft.x, mouthRight.y - mouthLeft.y)
  const mouthCenter = { x: (mouthLeft.x + mouthRight.x) / 2, y: (upperLip.y + lowerLip.y) / 2 }
  const mouthOpen = Math.max((lowerLip.y - upperLip.y) * 1.4, score('jawOpen') * mouthWidth * 0.34)
  ctx.fillStyle = '#6e3e3c'
  ctx.strokeStyle = '#6e3e3c'
  ctx.beginPath()
  if (mouthOpen > 2.5) {
    ctx.ellipse(mouthCenter.x, mouthCenter.y, mouthWidth * 0.32, Math.min(mouthOpen, mouthWidth * 0.28), 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.lineWidth = Math.max(1.5, mouthWidth * 0.07)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(mouthLeft.x + mouthWidth * 0.15, mouthCenter.y)
    ctx.quadraticCurveTo(mouthCenter.x, mouthCenter.y + mouthWidth * 0.025, mouthRight.x - mouthWidth * 0.15, mouthCenter.y)
    ctx.stroke()
  }
  ctx.restore()
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  const pipRef = useRef<Window | null>(null)
  const [condition, setCondition] = useState<Condition>('avatar')
  const [camera, setCamera] = useState(false)
  const [faceStatus, setFaceStatus] = useState<'未読込' | '読込中' | '準備完了' | '読込失敗'>('未読込')
  const [error, setError] = useState('')
  const pipSupported = 'documentPictureInPicture' in window

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (pipRef.current && !pipRef.current.closed) pipRef.current.close()
    faceLandmarkerRef.current?.close()
  }, [])

  const loadFaceLandmarker = async () => {
    if (faceLandmarkerRef.current) return
    setFaceStatus('読込中')
    try {
      const files = await FilesetResolver.forVisionTasks(wasmUrl)
      let landmarker: FaceLandmarker
      try {
        landmarker = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: faceModelUrl, delegate: 'GPU' },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        })
      } catch {
        landmarker = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: faceModelUrl, delegate: 'CPU' },
          runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        })
      }
      faceLandmarkerRef.current = landmarker
      setFaceStatus('準備完了')
    } catch (e) {
      console.error(e)
      setFaceStatus('読込失敗')
      setError('顔の追跡モデルを読み込めません。実写表示は引き続き利用できます。')
    }
  }

  const startCamera = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamera(true)
    } catch (e) {
      console.error(e)
      setError(e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'カメラの利用が許可されていません。ブラウザの設定を確認してください。'
        : 'カメラを利用できません。接続とブラウザの権限を確認してください。')
    }
  }

  useEffect(() => {
    if (condition === 'avatar' && camera && faceStatus === '未読込') void loadFaceLandmarker()
  }, [condition, camera, faceStatus])

  useEffect(() => {
    if (!camera || !videoRef.current || !canvasRef.current) return
    let raf = 0
    let lastFrame = 0
    const render = (now: number) => {
      raf = requestAnimationFrame(render)
      if (now - lastFrame < 80) return
      lastFrame = now
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!video || !canvas || !ctx || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      if (canvas.width !== 320 || canvas.height !== 240) { canvas.width = 320; canvas.height = 240 }

      if (condition === 'hidden') {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      if (condition !== 'avatar' || !faceLandmarkerRef.current || faceStatus !== '準備完了') return
      try {
        const faceResult = faceLandmarkerRef.current.detectForVideo(video, now)
        if (faceResult.faceLandmarks[0]) drawAvatarFace(ctx, faceResult.faceLandmarks[0], faceResult.faceBlendshapes[0]?.categories ?? [], canvas.width, canvas.height)
      } catch (e) {
        console.error('Face tracking failed:', e)
      }
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [camera, condition, faceStatus])

  const openPip = async () => {
    if (!pipSupported || condition === 'hidden') return
    try {
      const api = (window as unknown as Window & { documentPictureInPicture: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture
      const pip = await api.requestWindow({ width: 340, height: 280 })
      pipRef.current = pip
      pip.document.body.style.cssText = 'margin:0;background:#242724;display:grid;place-items:center'
      const canvas = pip.document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      canvas.style.cssText = 'width:320px;height:240px;transform:scaleX(-1)'
      pip.document.body.append(canvas)
      const copyFrame = () => {
        if (pip.closed) return
        if (canvasRef.current) canvas.getContext('2d')?.drawImage(canvasRef.current, 0, 0, 320, 240)
        requestAnimationFrame(copyFrame)
      }
      copyFrame()
      pip.addEventListener('pagehide', () => { pipRef.current = null })
    } catch (e) {
      console.error(e)
      setError('フローティング表示を開けませんでした。')
    }
  }

  const stopCamera = () => {
    if (pipRef.current && !pipRef.current.closed) pipRef.current.close()
    pipRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera(false)
  }

  return <main className="shell">
    <header><div className="brand">FIELD STUDY <span>PROTOTYPE</span></div><div className="privacy"><i />映像は端末内で処理し、保存しません</div></header>
    <section className="prototype">
      <div className="viewer-panel">
        <div className="conditions" role="group" aria-label="映像表示条件">{(['avatar','original','hidden'] as Condition[]).map(c => <button key={c} className={`condition ${condition === c ? 'selected' : ''}`} aria-pressed={condition === c} onClick={() => setCondition(c)}>{labels[c]}</button>)}</div>
        <div className="video-frame">
          {condition === 'hidden' ? <div className="empty-preview">自己映像は非表示です</div> : <canvas ref={canvasRef} width="320" height="240" aria-label={`${labels[condition]}映像`} />}
          <span className="preview-label">{labels[condition]}</span>
        </div>
        <video ref={videoRef} muted playsInline className="hidden-video" />
        <div className="status"><span className={`dot ${camera ? 'live' : ''}`} />{camera ? 'カメラ使用中' : 'カメラ未開始'}{condition === 'avatar' && <small> · 顔 {camera ? faceStatus : '未読込'}</small>}</div>
        {error && <p className="error" role="alert">{error}</p>}
        {!camera ? <button className="primary full" onClick={() => void startCamera()}>カメラを利用開始 <span>→</span></button> : <div className="controls"><button className="secondary" onClick={() => void openPip()} disabled={!pipSupported || condition === 'hidden'}>{pipSupported ? '小窓表示を開く ↗' : 'このブラウザは小窓表示に非対応'}</button><button className="text-button" onClick={stopCamera}>カメラを停止</button></div>}
        {camera && !pipSupported && <p className="hint">このブラウザでは、ブラウザ内表示のみ利用できます。</p>}
      </div>
    </section>
    <footer><span>LOCAL ONLY · NO RECORDING</span><span>顔モデルは初回に Google の配信元から取得します</span></footer>
  </main>
}
