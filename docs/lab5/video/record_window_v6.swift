import Foundation
import AppKit
import ScreenCaptureKit
import AVFoundation
import CoreGraphics

final class RecorderDelegate: NSObject, SCRecordingOutputDelegate, @unchecked Sendable {
    var finished = false
    func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) { print("RECORDING_STARTED \(Date().timeIntervalSince1970)"); fflush(stdout) }
    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) { finished = true; print("RECORDING_FINISHED"); fflush(stdout) }
    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) { print("RECORDING_ERROR: \(error)"); fflush(stdout) }
}

@main struct Main {
 static func main() async throws {
    _ = NSApplication.shared
    _ = CGMainDisplayID()
    let args = CommandLine.arguments
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    let windows = content.windows.filter { $0.owningApplication?.bundleIdentifier == "com.google.Chrome" && $0.frame.width > 600 }
    if args.count < 4 {
       for w in windows { print("WINDOW \(w.windowID) \(Int(w.frame.width))x\(Int(w.frame.height)) \(w.title ?? "")") }
       return
    }
    guard let id = UInt32(args[1]), let window = windows.first(where: {$0.windowID == id}), let seconds = Double(args[3]) else { fatalError("Expected window ID, output MP4, duration") }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width) * 2
    config.height = Int(window.frame.height) * 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.queueDepth = 6
    config.showsCursor = false
    config.capturesAudio = false
    config.captureMicrophone = false
    config.ignoreShadowsSingleWindow = true
    config.includeChildWindows = true
    let delegate = RecorderDelegate()
    let outputConfig = SCRecordingOutputConfiguration()
    outputConfig.outputURL = URL(fileURLWithPath: args[2])
    outputConfig.videoCodecType = .h264
    outputConfig.outputFileType = .mp4
    let output = SCRecordingOutput(configuration: outputConfig, delegate: delegate)
    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
    try stream.addRecordingOutput(output)
    try await stream.startCapture()
    try await Task.sleep(for: .seconds(seconds))
    try await stream.stopCapture()
    for _ in 0..<100 { if delegate.finished { break }; try await Task.sleep(for: .milliseconds(100)) }
    print("DURATION \(CMTimeGetSeconds(output.recordedDuration)) SIZE \(output.recordedFileSize)")
 }
}
