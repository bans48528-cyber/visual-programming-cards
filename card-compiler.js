// Shared block-to-source rules; native compilation stays in Android's private process.
(() => {
  if (!window.CardPlatform?.isAndroid) return;
  const native = window.Capacitor.registerPlugin('CardCompiler');
  let busy = false;
  window.CardCompiler = Object.freeze({
    async compile(program) {
      if (busy) throw new Error('已有程序正在编译。');
      const source = window.CardProgramCodegen(program);
      busy = true;
      try {
        const result = await native.compile({source});
        const bytecode = Uint8Array.from(atob(result.bytecode), char => char.charCodeAt(0));
        if (bytecode.length !== result.bytes || bytecode.length < 16 ||
            bytecode[0] !== 15 || bytecode[1] !== 112 || bytecode[2] !== 121 || bytecode[3] !== 111)
          throw new Error('编译结果无效。');
        return {source, bytecode, compilerVersion: result.compilerVersion};
      } finally { busy = false; }
    },
    cancel() { return native.cancel(); },
    get busy() { return busy; }
  });
})();
