import { useCallback, useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import './prototype.css'

type Condition = 'hidden' | 'original' | 'avatar' | 'adaptive'
type WorkState = 'working' | 'switching' | 'resting'
type DepthFrame = { width: number; height: number; depthScale: number; fx: number; fy: number; ppx: number; ppy: number; pixels: Uint16Array; color: Uint8Array; colorStride: number }
type Tracking = { x: number; y: number; width: number; yaw: number; pitch: number; roll: number; blink: number; mouth: number; depthMeters: number | null }
type LoadedAvatar = { vrm: VRM; box: THREE.Box3; center: THREE.Vector3; width: number }
type ModelOption = { id: string; name: string; url?: string }

const conditions: { id: Condition; number: string; title: string; description: string }[] = [
  { id: 'hidden', number: '01', title: '非表示', description: '自己表示なし' },
  { id: 'original', number: '02', title: '実写映像', description: '映像を表示' },
  { id: 'avatar', number: '03', title: '通常アバター', description: '顔の動きに連動' },
  { id: 'adaptive', number: '04', title: '状態反映アバター', description: '作業状態を表示' },
]

const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
const faceModelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const bundledModelUrls = import.meta.glob<string>('/src/assets/models/*.vrm', { eager: true, query: '?url', import: 'default' })
const bundledModels: ModelOption[] = Object.entries(bundledModelUrls).map(([path, url]) => {
  const file = path.split('/').pop() ?? 'VRM model'
  return { id: path, name: file.replace(/\.vrm$/i, '').replaceAll('_', ' '), url }
})

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }

function sampleDepth(frame: DepthFrame, normalizedX: number, normalizedY: number): number | null {
  const centerX = Math.round(clamp(normalizedX, 0, 1) * (frame.width - 1))
  const centerY = Math.round(clamp(normalizedY, 0, 1) * (frame.height - 1))
  const values: number[] = []
  for (let y = Math.max(0, centerY - 3); y <= Math.min(frame.height - 1, centerY + 3); y++) {
    for (let x = Math.max(0, centerX - 3); x <= Math.min(frame.width - 1, centerX + 3); x++) {
      const raw = frame.pixels[y * frame.width + x]
      const meters = raw * frame.depthScale
      if (raw > 0 && meters >= 0.12 && meters <= 4) values.push(meters)
    }
  }
  if (!values.length) return null
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

function disposeVrm(vrm: VRM) {
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose())
    else mesh.material.dispose()
  })
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null)
  const colorCanvasRef = useRef<HTMLCanvasElement>(null)
  const avatarCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const threeSceneRef = useRef<THREE.Scene | null>(null)
  const avatarRef = useRef<LoadedAvatar | null>(null)
  const avatarCacheRef = useRef<Map<string, LoadedAvatar>>(new Map())
  const pendingModelLoadsRef = useRef<Map<string, Promise<void>>>(new Map())
  const bundledBuffersRef = useRef<Map<string, Promise<ArrayBuffer>>>(new Map())
  const trackingRef = useRef<Tracking | null>(null)
  const depthFrameRef = useRef<DepthFrame | null>(null)
  const conditionRef = useRef<Condition>('avatar')
  const workStateRef = useRef<WorkState>('working')
  const [condition, setCondition] = useState<Condition>('avatar')
  const [workState, setWorkState] = useState<WorkState>('working')
  const [cameraOn, setCameraOn] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [depthConnected, setDepthConnected] = useState(false)
  const [faceDepth, setFaceDepth] = useState<number | null>(null)
  const [faceYaw, setFaceYaw] = useState<number | null>(null)
  const [faceRoll, setFaceRoll] = useState<number | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(bundledModels)
  const [selectedModel, setSelectedModel] = useState('')
  const [modelName, setModelName] = useState(bundledModels[0]?.name ?? 'アバターを選択してください')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { conditionRef.current = condition }, [condition])
  useEffect(() => { workStateRef.current = workState }, [workState])

  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false
    let timer = 0
    const pollDepth = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8090/depth', { cache: 'no-store' })
        if (!response.ok) throw new Error('Depth bridge unavailable')
        const buffer = await response.arrayBuffer()
        const view = new DataView(buffer)
        if (buffer.byteLength < 52 || view.getUint32(0, true) !== 0x50445352 || view.getUint16(4, true) !== 2) throw new Error('Invalid depth frame')
        const headerSize = view.getUint16(6, true)
        const width = view.getUint32(8, true)
        const height = view.getUint32(12, true)
        const pixelCount = width * height
        const colorBytes = view.getUint32(36, true)
        const colorStride = view.getUint32(40, true)
        const colorOffset = headerSize + pixelCount * 2
        if (headerSize < 52 || buffer.byteLength < colorOffset + colorBytes || colorStride < width * 3 || colorBytes < colorStride * height) throw new Error('Incomplete depth frame')
        const depthFrame: DepthFrame = {
          width,
          height,
          depthScale: view.getFloat32(16, true),
          fx: view.getFloat32(20, true),
          fy: view.getFloat32(24, true),
          ppx: view.getFloat32(28, true),
          ppy: view.getFloat32(32, true),
          pixels: new Uint16Array(buffer, headerSize, pixelCount),
          color: new Uint8Array(buffer, colorOffset, colorBytes),
          colorStride,
        }
        depthFrameRef.current = depthFrame
        const colorCanvas = colorCanvasRef.current
        const context = colorCanvas?.getContext('2d')
        if (colorCanvas && context) {
          if (colorCanvas.width !== width || colorCanvas.height !== height) {
            colorCanvas.width = width
            colorCanvas.height = height
          }
          const image = context.createImageData(width, height)
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const source = y * colorStride + x * 3
              const target = (y * width + x) * 4
              image.data[target] = depthFrame.color[source]
              image.data[target + 1] = depthFrame.color[source + 1]
              image.data[target + 2] = depthFrame.color[source + 2]
              image.data[target + 3] = 255
            }
          }
          context.putImageData(image, 0, 0)
        }
        setDepthConnected(true)
      } catch {
        depthFrameRef.current = null
        setDepthConnected(false)
      } finally {
        if (!cancelled) timer = window.setTimeout(pollDepth, 50)
      }
    }
    void pollDepth()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      depthFrameRef.current = null
      setDepthConnected(false)
      setFaceDepth(null)
      setFaceYaw(null)
      setFaceRoll(null)
    }
  }, [cameraOn])

  useEffect(() => {
    const stage = stageRef.current
    const canvas = avatarCanvasRef.current
    if (!stage || !canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    threeSceneRef.current = scene
    const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.03, 8)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8c7d75, 2.2))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1)
    keyLight.position.set(-1, 2, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xf4c3ad, 0.8)
    fillLight.position.set(2, -1, 2)
    scene.add(fillLight)

    const resize = () => {
      const rect = stage.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()

    let previousTime = performance.now()
    renderer.setAnimationLoop((time) => {
      const delta = Math.min((time - previousTime) / 1000, 0.05)
      previousTime = time
      const loaded = avatarRef.current
      const pose = trackingRef.current
      const hasDepthPose = Boolean(pose && pose.depthMeters)
      if (loaded) {
        const avatarVisible = Boolean(hasDepthPose && (conditionRef.current === 'avatar' || conditionRef.current === 'adaptive'))
        loaded.vrm.scene.visible = avatarVisible
      }
      if (loaded && pose && pose.depthMeters && (conditionRef.current === 'avatar' || conditionRef.current === 'adaptive')) {
        const depth = pose.depthMeters
        const overlayDepth = Math.max(depth - 0.02, 0.03)
        const frame = depthFrameRef.current
        if (frame) {
          camera.fov = 2 * Math.atan(frame.height / (2 * frame.fy)) * 180 / Math.PI
          camera.aspect = stage.clientWidth / Math.max(stage.clientHeight, 1)
          camera.updateProjectionMatrix()
        }
        const yawWidthCorrection = Math.min(1.8, 1 / Math.max(Math.cos(pose.yaw), 0.56))
        const targetWidth = Math.max(0.01, frame ? pose.width * frame.width / frame.fx * overlayDepth * yawWidthCorrection * 1.28 : 0.2)
        const scale = targetWidth / Math.max(loaded.width, 0.001)
        const avatarScene = loaded.vrm.scene
        avatarScene.scale.setScalar(scale)
        avatarScene.rotation.order = 'YXZ'
        avatarScene.rotation.set(pose.pitch, pose.yaw, pose.roll)
        const offset = loaded.center.clone().multiplyScalar(scale).applyEuler(avatarScene.rotation)
        const centerX = frame ? ((pose.x * frame.width - frame.ppx) / frame.fx) * overlayDepth + overlayDepth * 0.015 : (pose.x - 0.485) * overlayDepth
        const centerY = frame ? -((pose.y * frame.height - frame.ppy) / frame.fy) * overlayDepth : (0.5 - pose.y) * overlayDepth
        avatarScene.position.set(centerX - offset.x, centerY - offset.y, -overlayDepth - offset.z)

        const isAdaptive = conditionRef.current === 'adaptive'
        const tired = isAdaptive && workStateRef.current === 'resting' ? 0.65 : isAdaptive && workStateRef.current === 'switching' ? 0.22 : 0
        const expressions = loaded.vrm.expressionManager
        expressions?.setValue('blink', clamp(Math.max(pose.blink, tired * 0.8), 0, 1))
        expressions?.setValue('aa', clamp(Math.max(pose.mouth, tired * 0.1), 0, 1))
        expressions?.setValue('sad', tired)
        expressions?.setValue('relaxed', isAdaptive && workStateRef.current === 'resting' ? 0.35 : 0)
        loaded.vrm.update(delta)
      }
      renderer.render(scene, camera)
    })

    return () => {
      observer.disconnect()
      renderer.setAnimationLoop(null)
      renderer.dispose()
      threeSceneRef.current = null
    }
  }, [])

  const activateModel = useCallback((id: string, name: string) => {
    const model = avatarCacheRef.current.get(id)
    if (!model) return
    if (avatarRef.current && avatarRef.current !== model) avatarRef.current.vrm.scene.visible = false
    avatarRef.current = model
    model.vrm.scene.visible = Boolean(trackingRef.current?.depthMeters)
    setSelectedModel(id)
    setModelName(name)
    setError('')
  }, [])

  const loadModelBuffer = useCallback(async (id: string, name: string, buffer: ArrayBuffer) => {
    const cached = avatarCacheRef.current.get(id)
    if (cached) {
      activateModel(id, name)
      return
    }
    const pending = pendingModelLoadsRef.current.get(id)
    if (pending) {
      await pending
      activateModel(id, name)
      return
    }
    let finishLoad = () => {}
    const loadLock = new Promise<void>((resolve) => { finishLoad = resolve })
    pendingModelLoadsRef.current.set(id, loadLock)
    setBusy(true)
    setError('')
    try {
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMLoaderPlugin(parser))
      const gltf = await loader.parseAsync(buffer, '')
      const vrm = gltf.userData.vrm as VRM | undefined
      if (!vrm) throw new Error('VRMモデルを読み込めませんでした。')
      const threeScene = threeSceneRef.current
      if (!threeScene) throw new Error('3Dプレビューを初期化できませんでした。')
      if (vrm.meta.metaVersion === '0') VRMUtils.rotateVRM0(vrm)
      vrm.scene.visible = false
      vrm.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.frustumCulled = false
        mesh.castShadow = false
      })
      vrm.scene.updateMatrixWorld(true)
      const wholeBox = new THREE.Box3().setFromObject(vrm.scene)
      const wholeHeight = Math.max(wholeBox.max.y - wholeBox.min.y, 0.001)
      const headNames = /head|face|hair|eye|brow|mouth|lash|cheek|まゆ|髪|顔/i
      const candidateMeshes: THREE.Object3D[] = []
      vrm.scene.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return
        const box = new THREE.Box3().setFromObject(object)
        const centerHeight = (box.min.y + box.max.y) / 2
        if (headNames.test(object.name) || centerHeight > wholeBox.min.y + wholeHeight * 0.72) candidateMeshes.push(object)
      })
      if (candidateMeshes.length) {
        vrm.scene.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) object.visible = candidateMeshes.includes(object)
        })
      }
      vrm.scene.updateMatrixWorld(true)
      // Hidden body meshes still participate in Box3.setFromObject(scene), so
      // derive the registration anchor from face/head geometry explicitly.
      const namedFaceMeshes = candidateMeshes.filter((object) => /face|head|skin|顔|頭/i.test(object.name))
      const anchorMeshes = namedFaceMeshes.length ? namedFaceMeshes : candidateMeshes
      const box = new THREE.Box3()
      for (const object of anchorMeshes) box.expandByObject(object)
      if (box.isEmpty()) throw new Error('モデルの顔メッシュを見つけられませんでした。')
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const model = { vrm, box, center, width: Math.max(size.x, 0.001) }
      if (avatarRef.current) avatarRef.current.vrm.scene.visible = false
      threeScene.add(vrm.scene)
      avatarCacheRef.current.set(id, model)
      avatarRef.current = model
      vrm.scene.visible = Boolean(trackingRef.current?.depthMeters)
      setSelectedModel(id)
      setModelName(name)
      setError('')
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error ? cause.message : 'VRMファイルを読み込めませんでした。')
    } finally {
      setBusy(false)
      finishLoad()
      if (pendingModelLoadsRef.current.get(id) === loadLock) pendingModelLoadsRef.current.delete(id)
    }
  }, [activateModel])

  const loadModel = useCallback(async (file: File) => {
    const id = `local:${file.name}:${file.size}:${file.lastModified}`
    const name = file.name.replace(/\.vrm$/i, '')
    try {
      await loadModelBuffer(id, name, await file.arrayBuffer())
      setModelOptions((current) => current.some((item) => item.id === id) ? current : [...current, { id, name }])
    } catch (cause) {
      console.error(cause)
      setError('VRMファイルを読み込めませんでした。')
    }
  }, [loadModelBuffer])

  const loadBundledModel = useCallback(async (model: ModelOption) => {
    const cached = avatarCacheRef.current.get(model.id)
    if (cached) {
      activateModel(model.id, model.name)
      return
    }
    if (!model.url) return
    setBusy(true)
    try {
      let bufferPromise = bundledBuffersRef.current.get(model.id)
      if (!bufferPromise) {
        bufferPromise = fetch(model.url).then((response) => {
          if (!response.ok) throw new Error(`モデルを取得できませんでした (${response.status})`)
          return response.arrayBuffer()
        })
        bundledBuffersRef.current.set(model.id, bufferPromise)
      }
      await loadModelBuffer(model.id, model.name, await bufferPromise)
    } catch (cause) {
      console.error(cause)
      bundledBuffersRef.current.delete(model.id)
      setError(cause instanceof Error ? cause.message : 'VRMモデルを読み込めませんでした。')
    } finally {
      setBusy(false)
    }
  }, [activateModel, loadModelBuffer])

  useEffect(() => {
    const firstModel = bundledModels[0]
    if (firstModel) void loadBundledModel(firstModel)
  }, [loadBundledModel])

  useEffect(() => {
    const colorCanvas = colorCanvasRef.current
    if (!cameraOn || !colorCanvas) return
    let frame = 0
    let lastDetection = 0
    const detect = (time: number) => {
      frame = requestAnimationFrame(detect)
      const landmarker = landmarkerRef.current
      if (!landmarker || colorCanvas.width < 1 || colorCanvas.height < 1 || time - lastDetection < 50) return
      lastDetection = time
      try {
        const result = landmarker.detectForVideo(colorCanvas, time)
        const face = result.faceLandmarks[0]
        const blendshapes = result.faceBlendshapes[0]?.categories ?? []
        const getShape = (name: string) => blendshapes.find((shape) => shape.categoryName === name)?.score ?? 0
        if (!face) {
          trackingRef.current = null
          setTracking(false)
          setFaceDepth(null)
          setFaceYaw(null)
          setFaceRoll(null)
          return
        }
        const left = face[234], right = face[454], nose = face[1], forehead = face[10], chin = face[152]
        const eyeL = face[33], eyeR = face[263]
        const videoAspect = colorCanvas.width / Math.max(colorCanvas.height, 1)
        const stageRect = stageRef.current?.getBoundingClientRect()
        const stageAspect = stageRect ? stageRect.width / Math.max(stageRect.height, 1) : 4 / 3
        const cropX = Math.max(1, videoAspect / stageAspect)
        const cropY = Math.max(1, stageAspect / videoAspect)
        const mapX = (value: number) => 0.5 + (value - 0.5) * cropX
        const mapY = (value: number) => 0.5 + (value - 0.5) * cropY
        const faceWidth = Math.abs(right.x - left.x) * cropX
        const cheekCenterX = (left.x + right.x) / 2
        const centerX = mapX(cheekCenterX + (nose.x - cheekCenterX) * 0.35)
        const centerY = mapY((forehead.y + chin.y) / 2)
        const eyeLineRoll = -Math.atan2((eyeR.y - eyeL.y) * cropY, (eyeR.x - eyeL.x) * cropX)
        let roll = eyeLineRoll
        const depthYaw = ((left.z ?? 0) - (right.z ?? 0)) * 1.2
        const positionYaw = ((nose.x - cheekCenterX) / Math.max(Math.abs(right.x - left.x), 0.001)) * 1.8
        let yaw = clamp(positionYaw + depthYaw * 2, -1.25, 1.25)
        let posePitch: number | null = null
        let poseRoll: number | null = null
        const faceTransform = result.facialTransformationMatrixes[0]
        if (faceTransform?.data.length === 16) {
          const matrix = new THREE.Matrix4().fromArray(faceTransform.data)
          const matrixPosition = new THREE.Vector3()
          const quaternion = new THREE.Quaternion()
          const matrixScale = new THREE.Vector3()
          matrix.decompose(matrixPosition, quaternion, matrixScale)
          const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ')
          yaw = clamp(euler.y, -1.25, 1.25)
          posePitch = euler.x
          poseRoll = euler.z
        }
        roll = clamp(poseRoll ?? eyeLineRoll, -0.65, 0.65)
        const eyeLine = mapY((eyeL.y + eyeR.y) / 2)
        const faceHeight = Math.max(mapY(chin.y) - mapY(forehead.y), 0.001)
        const landmarkPitch = clamp(((mapY(nose.y) - eyeLine) / faceHeight - 0.32) * 1.2, -0.45, 0.45)
        const pitch = clamp(posePitch ?? landmarkPitch, -0.65, 0.65)
        const prior = trackingRef.current
        const depthFrame = depthFrameRef.current
        const rawDepth = depthFrame ? sampleDepth(depthFrame, nose.x, nose.y) : null
        const measured: Tracking = {
          x: centerX,
          y: centerY,
          width: faceWidth,
          yaw,
          pitch,
          roll,
          blink: Math.max(getShape('eyeBlinkLeft'), getShape('eyeBlinkRight')),
          mouth: Math.max(getShape('jawOpen'), getShape('mouthFunnel') * 0.4),
          depthMeters: prior?.depthMeters && rawDepth ? prior.depthMeters + (rawDepth - prior.depthMeters) * 0.38 : rawDepth,
        }
        const amount = prior ? 0.42 : 1
        trackingRef.current = prior ? {
          x: prior.x + (measured.x - prior.x) * amount,
          y: prior.y + (measured.y - prior.y) * amount,
          width: prior.width + (measured.width - prior.width) * amount,
          yaw: prior.yaw + (measured.yaw - prior.yaw) * amount,
          pitch: prior.pitch + (measured.pitch - prior.pitch) * amount,
          roll: prior.roll + (measured.roll - prior.roll) * amount,
          blink: measured.blink,
          mouth: prior.mouth + (measured.mouth - prior.mouth) * 0.6,
          depthMeters: measured.depthMeters,
        } : measured
        setTracking(true)
        setFaceDepth(measured.depthMeters)
        setFaceYaw(trackingRef.current.yaw)
        setFaceRoll(trackingRef.current.roll)
      } catch (cause) {
        console.error('Face tracking failed:', cause)
        setTracking(false)
      }
    }
    frame = requestAnimationFrame(detect)
    return () => cancelAnimationFrame(frame)
  }, [cameraOn])

  const startCamera = async () => {
    setError('')
    try {
      const response = await fetch('http://127.0.0.1:8090/health', { cache: 'no-store' })
        .catch(() => { throw new Error('RealSense depth bridge is not available') })
      if (!response.ok) throw new Error('RealSense depth bridge is not available')
      if (!landmarkerRef.current) {
        const files = await FilesetResolver.forVisionTasks(wasmUrl)
        let landmarker: FaceLandmarker
        try {
          landmarker = await FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: faceModelUrl, delegate: 'GPU' },
            runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
          })
        } catch {
          landmarker = await FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: faceModelUrl, delegate: 'CPU' },
            runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
          })
        }
        landmarkerRef.current = landmarker
      }
      setCameraOn(true)
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error && cause.message.includes('bridge')
        ? 'D415 ブリッジが停止しています。別のターミナルで「npm run depth:bridge」を実行してください。'
        : '顔追跡モデルを読み込めません。ネットワーク接続を確認してください。')
    }
  }

  const stopCamera = () => {
    trackingRef.current = null
    depthFrameRef.current = null
    setTracking(false)
    setDepthConnected(false)
    setFaceDepth(null)
    setFaceYaw(null)
    setFaceRoll(null)
    setCameraOn(false)
    const canvas = colorCanvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
  }

  useEffect(() => () => {
    landmarkerRef.current?.close()
    avatarCacheRef.current.forEach((avatar) => disposeVrm(avatar.vrm))
  }, [])

  const activeCondition = conditions.find((item) => item.id === condition)!

  return <main className="shell attention-shell">
    <header className="attention-header">
      <div className="attention-brand"><span className="brand-mark">◉</span><div><b>Self Attention</b><small>LAB / PROTOTYPE</small></div></div>
      <div className="prototype-badge"><i /> プロトタイプ <span>v0.1.0</span></div>
    </header>

    <section className="attention-layout">
      <aside className="setup-panel">
        <div className="eyebrow">実験セットアップ</div>
        <h1>表示条件を選ぶ</h1>
        <p className="panel-lead">表示方法を切り替えながら、プレビューを確認できます。</p>

        <div className="setup-section">
          <div className="section-kicker"><span>01</span> 表示条件</div>
          <div className="condition-list" role="radiogroup" aria-label="表示条件">
            {conditions.map((item) => <button key={item.id} className={`condition-card ${condition === item.id ? 'active' : ''}`} role="radio" aria-checked={condition === item.id} onClick={() => setCondition(item.id)}>
              <span className="condition-number">{item.number}</span><span className="condition-copy"><b>{item.title}</b><small>{item.description}</small></span><span className="radio-dot" />
            </button>)}
          </div>
        </div>

        <div className="setup-section">
          <div className="section-kicker"><span>02</span> カメラ</div>
          <div className="camera-card"><span className={`camera-indicator ${depthConnected ? 'on' : ''}`} /><div><b>{depthConnected ? 'RealSense D415 接続中' : 'D415 深度ブリッジ未接続'}</b><small>{depthConnected ? 'カラー映像・深度フレーム受信中' : 'npm run depth:bridge で起動'}</small></div>
            {cameraOn ? <button className="stop-button" onClick={stopCamera}>停止</button> : <button className="connect-button" onClick={() => void startCamera()}>接続</button>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <div className="setup-section">
          <div className="section-kicker"><span>03</span> アバターモデル</div>
          <div className="model-label">表示するモデル <span>VRM 0.x / 1.0</span></div>
          <div className="model-card"><span className="model-token">◉</span><span className="model-select-wrap"><select className="model-select" aria-label="表示するモデル" value={selectedModel} disabled={busy} onChange={(event) => {
            const model = modelOptions.find((item) => item.id === event.target.value)
            if (!model) return
            if (model.url) void loadBundledModel(model)
            else activateModel(model.id, model.name)
          }}>
            <option value="" disabled>モデルを選択</option>
            {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select><small>{busy ? 'モデルを読み込み中…' : avatarRef.current ? `${modelName} · ローカルに読み込み済み` : 'VRMモデルライブラリ'}</small></span><span className="model-type">VRM</span></div>
          <input ref={fileRef} className="file-input" type="file" accept=".vrm,model/gltf-binary,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadModel(file); event.currentTarget.value = '' }} />
          <button className="add-model" onClick={() => fileRef.current?.click()}>＋ VRMをライブラリに追加</button>
        </div>

        <div className="setup-section work-section">
          <div className="section-kicker"><span>04</span> 作業状態</div>
          <div className="work-state-buttons" role="group" aria-label="作業状態">
            <button className={workState === 'working' ? 'chosen' : ''} onClick={() => setWorkState('working')}>✦ 作業中</button>
            <button className={workState === 'switching' ? 'chosen' : ''} onClick={() => setWorkState('switching')}>▶ 気分転換</button>
            <button className={workState === 'resting' ? 'chosen' : ''} onClick={() => setWorkState('resting')}>◌ 休憩中</button>
          </div>
          <small className="section-hint">条件04のアバターに作業状態が反映されます</small>
        </div>
        <div className="privacy-note"><span>✥</span><div><b>プライバシーを大切に</b><small>映像・顔データは端末内で処理されます。</small></div></div>
      </aside>

      <section className="preview-panel">
        <div className="preview-heading"><div><div className="eyebrow">リアルタイムプレビュー</div><h2>あなたの作業スペース</h2></div><div className="live-meta"><i className={cameraOn ? 'on' : ''} /> {cameraOn ? 'LIVE PREVIEW' : 'PREVIEW'} <span>│</span> 4:3</div></div>
        <div className={`preview-stage ${condition === 'hidden' ? 'is-hidden' : ''}`} ref={stageRef}>
          <canvas ref={colorCanvasRef} className="preview-video" />
          <canvas ref={avatarCanvasRef} className={`avatar-canvas ${condition === 'avatar' || condition === 'adaptive' ? 'visible' : ''}`} />
          <span className="frame-corner top-left" /><span className="frame-corner top-right" /><span className="frame-corner bottom-left" /><span className="frame-corner bottom-right" />
          {condition === 'hidden' && <div className="hidden-overlay"><span>◉</span><b>自己映像は非表示です</b><small>カメラと顔トラッキングは継続しています</small></div>}
          {!cameraOn && condition !== 'hidden' && <div className="preview-start"><span>◉</span><b>カメラを接続してプレビューを開始</b><button onClick={() => void startCamera()}>カメラを接続</button></div>}
          {(condition === 'avatar' || condition === 'adaptive') && cameraOn && !depthConnected && <div className="model-prompt">深度ブリッジを起動すると、D415の距離に合わせて表示します</div>}
        </div>
        <div className="preview-caption"><span className="caption-index">{activeCondition.number}</span><div className="caption-copy"><b>{activeCondition.title}</b><small>{activeCondition.description}</small></div><span className={`tracking-label ${tracking && depthConnected ? 'on' : ''}`}><i />{tracking && depthConnected ? `顔・深度を追跡中 · ${faceDepth ? `${faceDepth.toFixed(2)} m` : '距離未取得'}${faceYaw === null ? '' : ` · 向き ${Math.round(faceYaw * 180 / Math.PI)}°`}${faceRoll === null ? '' : ` · 傾き ${Math.round(faceRoll * 180 / Math.PI)}°`}` : '顔・深度の接続待ち'}</span></div>
        <div className={`progress-bars ${condition === 'adaptive' ? 'adaptive' : ''}`}><i /><i /><i /></div>
        <div className="condition-message"><span>✦</span><span>条件{activeCondition.number}では{condition === 'adaptive' ? '作業状態に応じてアバターの表情やポーズが変化します。' : '顔の動きに合わせてアバターが追従します。'}</span></div>
      </section>
    </section>
    <footer className="attention-footer"><span>SELF ATTENTION SUPPORT SYSTEM</span><span>LOCAL PROTOTYPE · 2026</span></footer>
  </main>
}
