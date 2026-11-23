// The Mac app's front door: the same Samara.app starts normal Samara (macbrowser.ts). Nothing else happens here.
await import('./macbrowser.ts');
