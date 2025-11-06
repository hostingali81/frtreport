const { chromium } = require('playwright');

async function test() {
  console.log('Testing Playwright...');
  
  try {
    const browser = await chromium.launch({ headless: true });
    console.log('✅ Browser launched successfully');
    
    const page = await browser.newPage();
    console.log('✅ Page created successfully');
    
    await page.goto('https://example.com');
    console.log('✅ Navigation successful');
    
    const title = await page.title();
    console.log('✅ Page title:', title);
    
    await browser.close();
    console.log('✅ Browser closed successfully');
    
    console.log('🎉 Playwright is working correctly!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

test();