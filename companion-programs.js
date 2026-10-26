// Lightweight definitions only. Guide videos are loaded by the visible guide page.
(() => {
  'use strict';
  let reading;
  const clone = value => JSON.parse(JSON.stringify(value));
  function catalog() {
    if (!reading) reading = fetch('companion-programs.json', {cache: 'no-store'})
      .then(response => {
        if (!response.ok) throw new Error('配套程序暂时无法读取，请稍后重试。');
        return response.json();
      }).then(value => {
        if (value?.version !== 1 || !value.programs || !value.guides) throw new Error('配套程序资料格式无效。');
        return value;
      }).catch(error => { reading = null; throw error; });
    return reading;
  }
  window.CardCompanionCatalog = {
    async get(id, modelId) {
      const source = (await catalog()).programs[id];
      if (!source || source.id !== id || source.modelId !== modelId || !Array.isArray(source.state?.program)) {
        throw new Error('此造型的配套程序无效或型号不匹配。');
      }
      return clone(source);
    },
    async getGuide(id) {
      if (!id) return null;
      const source = (await catalog()).guides[id];
      if (!source || source.id !== id || !Array.isArray(source.pages) || !source.pages.length) throw new Error('使用指南资料暂不可用。');
      return clone(source);
    }
  };
})();
