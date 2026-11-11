import AppKit
import Foundation

let side: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(side), pixelsHigh: Int(side),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func color(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}

let full = NSRect(x: 0, y: 0, width: side, height: side)
let body = full.insetBy(dx: 52, dy: 52)
let squircle = NSBezierPath(roundedRect: body, xRadius: 214, yRadius: 214)
squircle.addClip()
NSGradient(colors: [color(0x2C2335), color(0x120F17)])!.draw(in: body, angle: -72)
NSGradient(colors: [color(0xE3B84A, 0.30), color(0xE3B84A, 0.0)])!
    .draw(fromCenter: NSPoint(x: side * 0.5, y: side * 0.88), radius: 0,
          toCenter: NSPoint(x: side * 0.5, y: side * 0.62), radius: side * 0.55, options: [])
NSGradient(colors: [color(0x000000, 0.0), color(0x000000, 0.32)])!
    .draw(in: NSRect(x: body.minX, y: body.minY, width: body.width, height: side * 0.4), angle: -90)

// Sound arcs, radiating from the disc at lower left.
let center = NSPoint(x: 455, y: 512)
for (i, radius) in [200.0, 282.0, 364.0].enumerated() {
    let arc = NSBezierPath()
    arc.appendArc(withCenter: center, radius: radius, startAngle: -52, endAngle: 52, clockwise: false)
    arc.lineWidth = 42
    arc.lineCapStyle = .round
    color(0xE6BE49, 0.85 - CGFloat(i) * 0.22).setStroke()
    arc.stroke()
}

// Disc with a play mark.
let disc = NSBezierPath(ovalIn: NSRect(x: center.x - 160, y: center.y - 160, width: 320, height: 320))
NSGradient(colors: [color(0xE9C55C), color(0xC9A227)])!.draw(in: disc, angle: -80)
let tri = NSBezierPath()
let cx = center.x + 18, cy = center.y
tri.move(to: NSPoint(x: cx - 62, y: cy + 84))
tri.line(to: NSPoint(x: cx + 96, y: cy))
tri.line(to: NSPoint(x: cx - 62, y: cy - 84))
tri.close()
color(0x221A0E).setFill()
tri.fill()

NSGraphicsContext.restoreGraphicsState()

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print(out)
