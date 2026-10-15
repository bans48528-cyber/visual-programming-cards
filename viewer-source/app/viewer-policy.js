// Product policy shared by settings, instructions and the complete-model viewer.
export function disableStudLogos(){
  if(LDR.Options)LDR.Options.studLogo=0;
  // Migrate previously saved values without changing any other preference.
  document.cookie='studLogo=0; SameSite=Strict; max-age=315360000; path=/';
  if(LDR.Studs){
    // The upstream complete-model example explicitly requests logo type 1.
    // Clamp both generation paths so every viewer mode stays logo-free.
    for(const name of ['makeGenerators','setStuds']){
      const original=LDR.Studs[name];
      LDR.Studs[name]=function(...args){args[2]=0;return original.apply(this,args);};
    }
  }
}
