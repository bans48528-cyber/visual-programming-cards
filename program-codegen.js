"use strict";
// Adapted from the installed desktop generator's documented API calls; no vendor code bundled.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CardProgramCodegen = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
return function generate(program) {
  let count=0;
  let usesPower=false;
  let usesComboPower=false;
  let usesCombo=false;
  const motorPort=value=>{
    const index=['E','F','G','H'].indexOf(value);
    if(index<0) throw new Error('电机端口必须为 E–H，请刷新页面并重新确认端口。');
    return index+4;
  };
  const sensorPort=value=>{
    const index=['A','B','C','D'].indexOf(value);
    if(index<0) throw new Error('传感器端口必须为 A–D。');
    return index;
  };
  const number=(v,min,max,label)=>{
    if(typeof v!=="number" || !Number.isFinite(v) || v<min || v>max) throw new Error(`${label}超出支持范围 ${min}–${max}。`);
    return v;
  };
  function sequence(items,depth=0,path=[]) {
    if(!Array.isArray(items) || depth>20) throw new Error("程序结构无效或嵌套过深。");
    return items.map((item,index)=>{
      const location=[...path,index+1];
      try {
      if(!item || ++count>1000) throw new Error("程序结构无效或积木超过 1000 块。");
      const id=item.id, p=item.params||{}, indent="    ".repeat(depth);
      let line;
      if (id === "motor-power" || id === "combo-power") {
        if (!["25","50","75","100"].includes(p.power)) throw new Error("电机功率必须为25%、50%、75%或100%。");
        if (id === "combo-power") usesComboPower=true;
        else usesPower=true;
        line=`${id === "combo-power" ? "combo_power" : "motor_power"} = ${Number(p.power)}`;
      } else if(id === "combo-direction") {
        if(!['3','0','1','2'].includes(p.mode)) throw new Error('组合电机旋转方向无效。');
        usesCombo=true;
        line=`_motor.pair(4, 5, ${Number(p.mode)})`;
      } else if(["motor-forward","motor-reverse","motor-stop","motor-forward-continuous","motor-reverse-continuous"].includes(id)) {
        const port=motorPort(p.port);
        if (id !== "motor-stop") usesPower=true;
        line=id.endsWith('-continuous') ? `_motor.run_power(${port}, ${id==='motor-reverse-continuous'?'-':''}motor_power)` : id==="motor-stop" ? `_motor.stop(${port})` :
          `_motor.run_for_power_seconds(${port}, ${id==="motor-forward"?"":"-"}motor_power, ${number(p.duration,0.1,86400,"运行时间")})`;
      } else if(['combo-forward','combo-backward','combo-turn-left','combo-turn-right','combo-stop','combo-continuous'].includes(id)) {
        usesCombo=true;
        if(id==='combo-stop') line='_motor.mov_stop()';
        else {
          usesComboPower=true;
          const direction=id==='combo-continuous' ? p.direction : {'combo-forward':'advance','combo-backward':'retreat','combo-turn-left':'left','combo-turn-right':'right'}[id];
          if(!['advance','retreat','left','right'].includes(direction)) throw new Error('组合移动方向无效。');
          line=id==='combo-continuous' ? `_motor.mov_dir_power("${direction}", combo_power)` : `_motor.mov_dir_power_seconds("${direction}", combo_power, ${number(p.duration,0.1,86400,'运行时间')})`;
        }
      } else if(['ultrasonic-sensor','grayscale-sensor','button-sensor','host-button'].includes(id)) {
        let condition;
        if(id==='host-button') {
          const key={'左键':'left','右键':'right'}[p.button];
          if(!key) throw new Error('主机按键无效。');
          condition=`_key.key_mast("${key}", 1)`;
        } else {
          const port=sensorPort(p.port);
          if(id==='button-sensor') {
            if(!['按下','松开'].includes(p.state)) throw new Error('触碰状态无效。');
            condition=`${p.state==='松开'?'not ':''}_touch.state(${port})`;
          } else {
            if(!['<','>','=='].includes(p.operator)) throw new Error('比较符号无效。');
            const ultrasonic=id==='ultrasonic-sensor';
            const value=number(ultrasonic?p.distance:p.value,0,ultrasonic?100:1000,'传感器阈值');
            condition=`${ultrasonic?'_ultrasion.cmp_value':'_color.cmp_lux'}(${port}, "${p.operator}", ${value})`;
          }
        }
        return `${indent}while not (${condition}):\n${indent}    _os.sleep_s(0.001)\n`;
      } else if(id==='play-note') {
        const note={'1':'c','2':'d','3':'e','4':'f','5':'g','6':'a','7':'b'}[p.note];
        if(!note) throw new Error('音符必须为1–7。');
        const beats=p.beats ?? '0.25';
        if(!['0.25','0.5','1','2'].includes(beats)) throw new Error('拍数无效。');
        line=`_beep.play_muic("${note}", ${Number(beats)})`;
      } else if(id==='matrix-display') {
        if(!Array.isArray(p.pattern) || p.pattern.length!==25 || p.pattern.some(v=>v!==0 && v!==1)) throw new Error('点阵必须为25个0/1像素。');
        const rows=[0];
        for(let y=0;y<5;y++) rows.push(p.pattern.slice(y*5,y*5+5).reduce((bits,v,x)=>bits|(v<<x),0));
        rows.push(0);
        line=`_matrix.show(${rows.map(row=>'0x'+row.toString(16).toUpperCase().padStart(2,'0')).join(', ')})`;
      } else if(id==="wait-time") line=`_os.sleep_s(${number(p.duration,0.1,86400,"等待时间")})`;
      else if(id==="loop" || id==="loop-count") {
        const n=id==="loop-count" ? number(p.count,1,1000000,"循环次数") : 0;
        if(!Number.isInteger(n)) throw new Error("循环次数必须为整数。");
        line=id==="loop" ? "while True:" : `for count_${depth} in range(${n}):`;
        return indent+line+"\n"+sequence(item.children,depth+1,location)+indent+"    _os.sleep_s(0.001)\n";
      } else throw new Error(`暂不支持发送积木 ${id}：需补充硬件端口、动作或点阵映射，未发送任何程序。`);
      return indent+line+"\n";
      } catch(error) {
        if(error.blockPath) throw error;
        error.blockPath=location.join('.');
        error.message=`积木 ${error.blockPath}：${error.message}`;
        throw error;
      }
    }).join("");
  }
  if(!Array.isArray(program) || !program.length) throw new Error("请先放入积木。");
  const body=sequence(program);
  return (usesPower ? "motor_power = 50\n" : "")+(usesComboPower ? "combo_power = 50\n" : "")+
    (usesCombo ? '_motor.pair(4, 5, 1)\n_motor.mov_set_stop_module(1)\n' : '')+body;
};

});
