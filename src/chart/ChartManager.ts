import { App } from "../App";
import { Simfile } from "./sm/Simfile";
import { ChartRenderer } from "./ChartRenderer";
import { ChartAudio } from "./audio/ChartAudio"
import { Howl } from 'howler';
import { IS_OSX } from "../data/KeybindData"
import { Chart } from "./sm/Chart"
import { NoteTexture } from "./note/NoteTexture"
import { BitmapText } from "pixi.js"
import { bsearch, getFPS, roundDigit } from "../util/Util"

const SNAPS = [1,2,3,4,6,8,12,16,24,48,-1]

export class ChartManager {

  app: App

  songAudio: ChartAudio = new ChartAudio()
  chartView?: ChartRenderer
  info: BitmapText
  assistTick: Howl = new Howl({
    src: 'assets/sound/assist_tick.ogg',
    volume: 0.5
  })
  me_high: Howl = new Howl({
    src: 'assets/sound/metronome_high.ogg',
    volume: 0.5
  });
  me_low: Howl = new Howl({
    src: 'assets/sound/metronome_low.ogg',
    volume: 0.5
  });
  sm?: Simfile
  sm_path: string = ""
  chart?: Chart

  private beat: number = 0
  private time: number = 0

  private snapIndex: number = 0
  private partialScroll: number = 0
  private noteIndex: number = 0
  private lastBeat: number = -1

  constructor(app: App) {

    this.app = app
    NoteTexture.initArrowTex(app)

    app.view.addEventListener?.("wheel", (event: WheelEvent) => {
      if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
      if ((IS_OSX && event.metaKey) || (!IS_OSX && event.ctrlKey)) {
        this.app.options.chart.speed = Math.max(10, app.options.chart.speed * Math.pow(1.01, event.deltaY / 5 * app.options.input.scrollSensitivity))
      }else{
        let newbeat = this.beat
        let snap = app.options.chart.snap
        let speed = app.options.chart.speed
        if (snap == 0) {
          this.partialScroll = 0
          newbeat = this.beat + event.deltaY/speed * app.options.input.scrollSensitivity
        }else{
          this.partialScroll += event.deltaY/speed * app.options.input.scrollSensitivity
          if (Math.abs(this.partialScroll) > snap) {
            if (this.partialScroll < 0) newbeat = Math.round((this.beat+Math.ceil(this.partialScroll/snap)*snap)/snap)*snap
            else newbeat = Math.round((this.beat+Math.floor(this.partialScroll/snap)*snap)/snap)*snap
            this.partialScroll %= snap
          }
        }
        newbeat = Math.max(0,newbeat)
        if (newbeat != this.beat)  this.setBeat(newbeat)
      }
    });

    this.info = new BitmapText("", {
      fontName: "Assistant",
      fontSize: 20,
    })
    this.info.x = 0
    this.info.y = 0
    this.info.zIndex = 1
    this.app.pixi.stage.addChild(this.info)
    this.app.pixi.ticker.add(() => {
      if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
      this.chartView?.render();
      this.info.text = "Time: " + roundDigit(this.time,3) + "\n" + "Beat: " + roundDigit(this.beat,3) + "\nFPS: " + getFPS(this.app.pixi)
    });
    
    setInterval(()=>{
      if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
      let time = this.songAudio.seek()
      if (this.songAudio.isPlaying()) this.setTime(time) 

      let notedata = this.chart.notedata
      let hasPlayed = false
      while(this.noteIndex < notedata.length && time > notedata[this.noteIndex].second + app.options.audio.effectOffset) {
        if (this.songAudio.isPlaying() && (notedata[this.noteIndex].type != "Fake" && notedata[this.noteIndex].type != "Mine") && !notedata[this.noteIndex].fake) {
          this.chartView.addFlash(notedata[this.noteIndex].col)
          if (!hasPlayed && app.options.audio.assistTick) {
            this.assistTick.play()
            hasPlayed = true
          }
        }
        this.noteIndex++
      }
      let metronomeBeat = Math.floor(this.chart.getBeat(this.time + app.options.audio.effectOffset))
      if (metronomeBeat != this.lastBeat) {
        this.lastBeat = metronomeBeat
        if (this.songAudio.isPlaying() && app.options.audio.metronome) {
          if (this.lastBeat % 4 == 0) this.me_high.play()
          else this.me_low.play()
        }
      }
    })

    window.addEventListener("resize", ()=>{
      if (this.chartView) {
        this.chartView.view.x = this.app.pixi.screen.width/2
        this.chartView.view.y = this.app.pixi.screen.height/2
      }
    })
  }

  getBeat(): number {
    return this.beat
  }

  getTime(): number {
    return this.time
  }

  setBeat(beat: number) {
    if (!this.chart) return
    beat = Math.max(0, beat)
    let seekBack = this.beat > beat
    this.beat = beat
    this.time = this.chart.getSeconds(this.beat)
    this.songAudio.seek(this.time)
    if (seekBack) this.seekBack()
  }

  setTime(time: number) {
    if (!this.chart) return
    let seekBack = this.time > time
    this.time = time
    this.beat = this.chart.getBeat(this.time)
    if (this.beat < 0) this.setBeat(0)
    if (seekBack) this.seekBack()
  }

  async loadSM(path: string) {
    this.sm_path = path
    this.time = 0
    this.beat = 0

    let smFile = await this.app.files.getFile(path)
    this.sm = new Simfile(smFile)
    await this.sm.loaded
    
    this.loadChart()
    this.loadAudio()
  }

  loadChart(chart?: Chart) {
    if (this.sm == undefined) return
    if (chart == undefined) {
      let charts = this.sm.charts[this.app.options.chart.stepsType]
      if (charts!.length == 0) return
      chart = charts![charts!.length - 1]
    }
    
    this.chart = chart
    this.beat = this.chart.getBeat(this.time)
  
    if (this.chartView) this.app.pixi.stage.removeChild(this.chartView.view)
      
    this.seekBack()
    this.chartView = new ChartRenderer(this)
    this.chartView.view.x = this.app.pixi.screen.width/2
    this.chartView.view.y = this.app.pixi.screen.height/2
    
  }
  

  async loadAudio() {
    if (!this.sm) return
    this.songAudio.stop()
    let audio_onload = (audio: ChartAudio) => {
      audio.seek(this.chart?.getSeconds(0) ?? this.sm!.timingData.getSeconds(0))
      this.setTime(this.chart?.getSeconds(0) ?? this.sm!.timingData.getSeconds(0)) 
      this.updateSoundProperties()
    }

    if (!this.sm.properties.MUSIC || this.sm.properties.MUSIC == "") {
      console.warn("No Audio File!")
      this.songAudio = new ChartAudio(undefined, audio_onload)
      return
    }
    let audioFile: File | undefined = this.app.files.getFileRelativeTo(this.sm_path,this.sm.properties.MUSIC)
    if (audioFile == undefined) {
      console.warn("Failed to load audio file " + this.sm.properties.MUSIC)
      this.songAudio = new ChartAudio(undefined, audio_onload)
      return
    }
    let audio_url = await URL.createObjectURL(audioFile)
    this.songAudio = new ChartAudio(audio_url, audio_onload)

    this.seekBack()
  }

  getAudio(): ChartAudio {
    return this.songAudio
  }

  updateSoundProperties() {
    this.setEffectVolume(this.app.options.audio.soundEffectVolume)
    this.setVolume(this.app.options.audio.songVolume)
    this.setRate(this.app.options.audio.rate)
  }

  setRate(rate: number) {
    this.app.options.audio.rate = rate
    this.songAudio.rate(rate)
  }
  
  setVolume(volume: number) {
    this.app.options.audio.songVolume = volume
    this.songAudio.volume(volume)
  }
  
  setEffectVolume(volume: number) {
    this.app.options.audio.soundEffectVolume = volume
    this.assistTick.volume(volume)
    this.me_high.volume(volume)
    this.me_low.volume(volume)
  }

  seekBack() {
    if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) {
      this.noteIndex = 0
      return
    }
    this.noteIndex = bsearch(this.chart.notedata, this.time, a => a.second)
    // let notedata = this.chart.notedata
    // if (this.noteIndex > notedata.length) this.noteIndex = notedata.length - 1
    // while(this.noteIndex > 0 && this.time < notedata[this.noteIndex-1].second) {
    //   this.noteIndex--
    // }
  }

  playPause() {
    if (this.songAudio.isPlaying()) this.songAudio.pause()
    else this.songAudio.play()
  }

  setAndSnapBeat(beat: number) {
    let snap = Math.max(0.001,this.app.options.chart.snap)
    let newbeat = Math.round((beat)/snap)*snap
    newbeat = Math.max(0,newbeat)
    this.setBeat(newbeat)
  }
  
  previousSnap(){
    this.snapIndex = ((this.snapIndex-1) + SNAPS.length) % SNAPS.length
    this.app.options.chart.snap = SNAPS[this.snapIndex]==-1?0:1/SNAPS[this.snapIndex]
  }
  
  nextSnap(){
    this.snapIndex = ((this.snapIndex+1) + SNAPS.length) % SNAPS.length
    this.app.options.chart.snap = SNAPS[this.snapIndex]==-1?0:1/SNAPS[this.snapIndex]
  }

  private removeDuplicateBeats(arr: number[]): number[] {
    if (arr.length === 0) return arr;
    var ret = [arr[0]];
    for (var i = 1; i < arr.length; i++) { 
      if (arr[i-1] !== arr[i]) {
        ret.push(arr[i]);
      }
    }
    return ret;
  }

  previousNote() {
    if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
    if (this.chart.notedata.length == 0) return
    let holdTails = this.chart.notedata.filter(note => note.hold).map(note => note.beat + note.hold!)
    let beats = this.chart.notedata.map(note => note.beat).concat(holdTails).sort((a,b)=>a-b)
    beats = this.removeDuplicateBeats(beats)
    let index = bsearch(beats, this.beat)
    if (this.beat == beats[index]) index--
    this.setBeat(beats[Math.max(0, index)])
  }

  nextNote() {
    if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
    if (this.chart.notedata.length == 0) return
    let holdTails = this.chart.notedata.filter(note => note.hold).map(note => note.beat + note.hold!)
    let beats = this.chart.notedata.map(note => note.beat).concat(holdTails).sort((a,b)=>a-b)
    beats = this.removeDuplicateBeats(beats)
    let index = bsearch(beats, this.beat)
    if (this.beat >= beats[index]) index++
    this.setBeat(beats[Math.min(beats.length - 1, index)])
  }

  firstNote() {
    if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
    if (this.chart.notedata.length == 0) return
    this.setBeat(this.chart.notedata[0].beat)
  }

  lastNote() {
    if (this.sm == undefined || this.chart == undefined || this.chartView == undefined) return
    if (this.chart.notedata.length == 0) return
    let note = this.chart.notedata[this.chart.notedata.length-1]
    this.setBeat(note.beat + (note.hold ?? 0))
  }
}


