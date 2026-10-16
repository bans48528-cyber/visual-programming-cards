// Building viewers now open through a book, which remains underneath the viewer
// so returning preserves the selected album and page.
async function openBuildingBook(page){
 const reader=page.locator('#buildingBooksReader');
 if(!await reader.isVisible())await page.locator('.building-books-shelf .book-button').first().click();
 await page.locator('#buildingBooksReader[data-phase="open"]').waitFor();
 return reader;
}

async function openBuilding(page,name){
 const reader=await openBuildingBook(page);
 const accessibleName=typeof name==='string'?'去搭建'+name:name;
 await reader.getByRole('button',{name:accessibleName,exact:typeof name==='string'}).click();
}

async function closeBuildingBook(page){
 const reader=page.locator('#buildingBooksReader');
 await page.locator('#buildingBooksReader[data-phase="open"]').waitFor();
 await reader.locator('#bb-close-reader').click();
 await reader.waitFor({state:'hidden'});
}

module.exports={openBuildingBook,openBuilding,closeBuildingBook};
