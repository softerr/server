import div1 from "./div1";

const initView = (view) => {
        view.views = view.render();
        view.views.forEach(childView => {
                initView(childView)
                view.element.appendChild(childView.element);
        });
}

const printTree = (root) => {
        console.log(root);
        root.views.forEach(view => {
                printTree(view);
        })
}

export default function () {
        const root = new div1();

        initView(root);

        printTree(root);

        document.body.innerHTML = '';
        document.body.appendChild(root.element);


        //document.body.innerHTML = '<h1>render</h1>';
}