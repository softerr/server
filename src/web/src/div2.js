import div3 from "./div3";

export default class {
        constructor() {
                this.element = document.createElement('div');
                this.element.id = 'div2';
        }

        render() {
                const div3 = modules.div3;
                return [new div3()];
        }
}

if (module.hot) {
        module.hot.accept('./div3', () => {
                modules.div3 = require('./div3');
                console.log('hot: div3');
        });
}

const modules = {
        div3: div3
};
