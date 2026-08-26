# Audio Noise Reduction Improvements

## Overview
Enhanced background noise reduction for live prayer room sessions using advanced Web Audio API processing and adaptive algorithms.

## Improvements Made

### 1. Enhanced Noise Suppression Filters
- **High-pass filter**: Increased cutoff from 80Hz to 100Hz to better remove low-frequency rumble and wind noise
- **Low-pass filter**: Reduced cutoff from 8kHz to 7kHz to focus on voice range and remove high-frequency hiss
- **Notch filters**: Added filters for both 50Hz (EU/Asia) and 60Hz (US) electrical hum
- **Voice bandpass filter**: Added bandpass filter focusing on 300Hz-3400Hz voice range
- **Adaptive noise gate**: Dynamic compressor-based gate that adjusts threshold based on background noise

### 2. Multi-Stage Echo Cancellation
- **Two-stage compression**: Added cascaded compressors for better echo reduction
- **Faster attack times**: Reduced to 0.001s to catch echoes quickly
- **Optimized thresholds**: Lower thresholds (-30dB and -20dB) for better echo suppression

### 3. Multi-Band Voice Enhancement
- **Three-band EQ**: Separate filters for low (500Hz), mid (1500Hz), and high (3000Hz) voice frequencies
- **Mid-frequency boost**: Stronger boost (+4dB) at 1500Hz where voice clarity is most important
- **Gentle compression**: Softer compression settings for more natural sound

### 4. Adaptive Noise Gate
- **Automatic calibration**: Collects 30 samples (~1 second) to determine baseline background noise
- **Dynamic adjustment**: Automatically adjusts gate threshold based on current noise levels
- **Real-time monitoring**: Continuously monitors and adapts to changing noise conditions

### 5. Enhanced Browser Audio Constraints
- **Google-specific options**: Added `googEchoCancellation2`, `googNoiseSuppression2`, and `googAutoGainControl2` for Chrome/Edge
- **Better fallback**: Improved error handling with graceful fallback to basic constraints

### 6. Improved Audio Processing Chain
- **Fixed chain connection**: Corrected audio processing chain to properly connect all nodes
- **Peer connection updates**: Added automatic update of peer connections when processed stream is ready
- **Better error handling**: Graceful fallback if advanced processing fails

## Technical Details

### Audio Processing Chain
```
Microphone Input
    ↓
Gain Controller
    ↓
Noise Suppressor (High-pass → Notch Filters → Low-pass → Bandpass → Noise Gate)
    ↓
Echo Canceller (Compressor 1 → Compressor 2)
    ↓
Audio Enhancer (EQ Low → EQ Mid → EQ High → Compressor)
    ↓
Audio Analyser (for monitoring)
    ↓
Processed Output → WebRTC Peer Connections
```

### Filter Specifications

**Noise Suppressor:**
- High-pass: 100Hz cutoff, Q=0.7
- Notch 60Hz: Q=30
- Notch 50Hz: Q=30
- Low-pass: 7000Hz cutoff, Q=0.7
- Bandpass: 1850Hz center, Q=0.5
- Noise Gate: Threshold=-50dB, Ratio=20:1, Attack=0.001s, Release=0.1s

**Echo Canceller:**
- Stage 1: Threshold=-30dB, Ratio=8:1, Attack=0.001s, Release=0.15s
- Stage 2: Threshold=-20dB, Ratio=4:1, Attack=0.003s, Release=0.1s

**Audio Enhancer:**
- EQ Low: 500Hz, +2dB, Q=1
- EQ Mid: 1500Hz, +4dB, Q=1.5
- EQ High: 3000Hz, +2dB, Q=1
- Compressor: Threshold=-18dB, Ratio=3:1, Attack=0.005s, Release=0.08s

## Expected Results

1. **Reduced Background Noise**: High-pass and low-pass filters remove noise outside voice range
2. **Eliminated Electrical Hum**: Notch filters remove 50Hz/60Hz electrical interference
3. **Better Voice Clarity**: Multi-band EQ enhances voice frequencies while suppressing noise
4. **Adaptive Performance**: Noise gate automatically adjusts to different environments
5. **Improved Echo Reduction**: Multi-stage compression better handles echo and feedback

## Browser Compatibility

- **Chrome/Edge**: Full support with Google-specific enhancements
- **Firefox**: Standard Web Audio API support
- **Safari**: Standard Web Audio API support (may have limitations)
- **Fallback**: Gracefully falls back to basic noise suppression if advanced features unavailable

## Testing Recommendations

1. Test in quiet environment to verify voice clarity
2. Test in noisy environment (fan, traffic, etc.) to verify noise reduction
3. Test with multiple participants to verify echo cancellation
4. Test on different devices (mobile, desktop, laptop)
5. Monitor console logs for audio processing status

## Monitoring

Check browser console for these logs:
- `🎛️ Enhanced noise suppressor created with adaptive gating`
- `🎛️ Enhanced echo canceller created with multi-stage compression`
- `🎛️ Enhanced audio enhancer created with multi-band EQ`
- `🎛️ Audio processing chain created and applied`
- `🎛️ Adaptive noise gate started`
- `🎛️ Noise gate calibrated: background=X, threshold=YdB`

## Future Enhancements

Potential future improvements:
1. Machine learning-based noise reduction
2. User-adjustable noise gate sensitivity
3. Per-participant audio quality indicators
4. Automatic audio quality optimization based on network conditions
5. Support for external audio processing plugins

