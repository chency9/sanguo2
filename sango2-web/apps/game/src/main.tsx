import React from 'react';
import { createRoot } from 'react-dom/client';
import { validateContent } from '@sango2/content';
import { App } from './App';
import './styles.css';
import './classic.css';
import './battle-roster.css';
import './battle-fullscreen.css';

const root = createRoot(document.getElementById('root')!);
root.render(<main className="boot"><span className="seal">群</span><h1>山河将启</h1><p>正在载入五朝风云…</p></main>);
fetch('/assets/content.json').then(async response => {
  if (!response.ok) throw new Error('未找到游戏资料，请先运行资源转换脚本。');
  const content: unknown = await response.json(); validateContent(content);
  root.render(<React.StrictMode><App content={content} /></React.StrictMode>);
}).catch(error => root.render(<main className="boot"><h1>未能展开山河图</h1><p role="alert">{String(error.message)}</p><button onClick={() => location.reload()}>重新载入</button></main>));
