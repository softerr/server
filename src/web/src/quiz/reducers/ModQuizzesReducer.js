const ModQuizzesReducer = (state = { quizzes: [] }, action) => {
    switch (action.type) {
        case "MOD_QUIZZES_SET":
            return { quizzes: action.quizzes };
        case "MOD_QUIZZES_SET_QUIZ_STATUS":
            state.quizzes[action.index].status = action.status;
            return { quizzes: state.quizzes };
        default:
            return state;
    }
};

export default ModQuizzesReducer;
