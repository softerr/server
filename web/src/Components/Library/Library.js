import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Button, Card, Col, Container, Modal, Row } from "react-bootstrap";
import { Eye, PencilSquare, Plus, Trash } from "react-bootstrap-icons";
import myFetch from "../../hooks/myFetch";

function DeleteModal({ show, onYes, onNo, name }) {
    return (
        <Modal show={show} size="md" aria-labelledby="contained-modal-title-vcenter" centered>
            <Modal.Header closeButton>
                <Modal.Title id="contained-modal-title-vcenter">Delete {name}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>Are you sure you want to delete this quiz?</p>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="primary" onClick={onNo}>
                    No
                </Button>
                <Button variant="danger" onClick={onYes}>
                    Yes
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

const Library = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedUserQuizzes = useSelector(state => state.userQuizzes);
    const [{ quizzes, loading, error }, setState] = useState({});
    const dispatch = useDispatch();
    const [modal, setModal] = useState({ show: false, id: 0 });

    const onModalYes = () => {
        myFetch(
            `/api/quiz/users/${cachedUser.id}/quizzes/${modal.id}`,
            "DELETE",
            cachedUser.token,
            undefined,
            () => {
                dispatch({ type: "USER_QUIZZES_DEL", userId: cachedUser.id, id: modal.id });
                setState({ quizzes: cachedUserQuizzes.userQuizzes[cachedUser.id], loading: false, error: null });
            },
            res => {
                console.log(res);
            }
        );
        setModal({ show: false });
    };

    useEffect(() => {
        if (cachedUserQuizzes.userQuizzes[cachedUser.id] && cachedUserQuizzes.userQuizzes[cachedUser.id].length > 0) {
            setState({ quizzes: cachedUserQuizzes.userQuizzes[cachedUser.id], loading: false, error: null });
            return;
        }
        setState({ loading: true, error: null });
        return myFetch(
            `/api/quiz/users/${cachedUser.id}/quizzes`,
            "GET",
            cachedUser.token,
            undefined,
            data => {
                dispatch({ type: "USER_QUIZZES_SET", userId: cachedUser.id, userQuizzes: data });
                setState({ quizzes: data, loading: false, error: null });
            },
            res => {
                setState({ loading: false, error: res });
            },
            msg => {
                setState({ loading: false, error: msg });
            }
        );
    }, [cachedUser.id]);

    return (
        <Container className="content px-3">
            <h1 style={{ marginBottom: "50px" }}>Library</h1>
            {error && <div>{error}</div>}
            {loading && <div>Loading...</div>}
            {quizzes && (
                <Row className="g-4">
                    {quizzes.map(quiz => (
                        <Col xs={12} sm={6} lg={4} key={quiz.id} className="d-flex justify-content-center">
                            <Card style={{ width: "100%", minWidth: "235px", border: "1px solid #e8e8e8" }}>
                                <Card.Header style={{ borderBottom: "0px", backgroundColor: "#e8e8e8" }}>
                                    <Row className="g-3">
                                        <Col className="d-flex flex-grow-1 align-items-center">Quiz</Col>
                                        <Col xs={"auto"}>
                                            <Button variant="primary" className="p-1 icon-button d-flex align-items-center justify-content-center">
                                                <Eye size={16} />
                                            </Button>
                                        </Col>
                                        <Col xs={"auto"}>
                                            <Button variant="primary" className="p-1 icon-button d-flex align-items-center justify-content-center" as={Link} to={`/quiz/library/${quiz.id}/edit`} state={{ quiz }}>
                                                <PencilSquare size={16} />
                                            </Button>
                                        </Col>
                                        <Col xs={"auto"}>
                                            <Button variant="danger" className="p-1 icon-button d-flex align-items-center justify-content-center" onClick={() => setModal({ show: true, id: quiz.id, name: quiz.name })}>
                                                <Trash size={16} />
                                            </Button>
                                        </Col>
                                    </Row>
                                </Card.Header>
                                <Card.Body className="d-flex flex-column">
                                    <Card.Title>{quiz.name}</Card.Title>
                                    <Card.Text style={{ marginBottom: "auto" }}>{quiz.description ? quiz.description : ""}</Card.Text>
                                    <Card.Text className="text-secondary" style={{ marginBottom: "auto" }}>
                                        {quiz.question_count} {quiz.question_count === 1 ? "question" : "questions"}
                                    </Card.Text>
                                </Card.Body>
                            </Card>
                        </Col>
                    ))}
                    <Col key={0} xs={12} sm={6} lg={4} className="d-flex justify-content-center">
                        <Card as={Link} to={`/quiz/library/create`} style={{ width: "100%", minWidth: "240px", minHeight: "150px" }}>
                            <Card.Body className="d-flex align-items-center justify-content-center">
                                <Plus size={80} color={"#979797"}></Plus>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}
            <DeleteModal name={modal.name} show={modal.show} onYes={onModalYes} onNo={() => setModal({ show: false })} />
        </Container>
    );
};

export default Library;
