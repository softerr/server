import App from "../App";

const renderView = (View) => {
    
    if (typeof View === 'string') {
        element.innerHTML = View;
        return element;
    }
    
    const component = new View.view(View.params);
    component.element = document.createElement('div');
    
    const childs = component.child();

    for (const child of childs) {
        element.appendChild(renderView(child));
    }
   
    return element;
}

const renderApp = (App) => {
    const element = renderView({ view: App });
    document.body.innerHTML = '';
    document.body.appendChild(element)
}

export default function () {
    renderApp(App);
};

if (module.hot) {
    module.hot.accept('../App.js', () => {
        renderApp(require('../App.js').default);
    });
}
