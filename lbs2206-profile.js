// GATT and four-byte remote frames verified on K_motor / 5.0B, 2026-09-29.
// 20 bytes is a transport ceiling, NOT a verified program capacity.
window.Lbs2206Profile=Object.freeze({
  namePrefixes:['K_motor'],
  serviceUuid:'6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  writeUuid:'6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  notifyUuid:'6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  writeMode:'no-response',gattVerified:true,remoteVerified:true,
  remoteModeCommand:false,remoteStopRepeats:3,
  maxFrameBytes:20,frameGapMs:200,atomicFrameVerified:false,
  safeActions:null,programVerified:false,
  evidence:'2026-09-29 K_motor 5.0B: 无响应写入，最大档前进与停止重复实测通过；其他方向与档位待复核，程序未验证。'
});
