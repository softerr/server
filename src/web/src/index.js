import './index.css'
import render from './render/render.js';

const navigateTo = url => {
    history.pushState({}, '', url);
    render();
};

window.addEventListener('popstate', render);

document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('click', e => {
        if (e.target.matches('[data-link]')) {
            e.preventDefault();
            navigateTo(e.target.href);
        }
    })
    render();
});
