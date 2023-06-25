import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Button, Col, Container, Modal, Row, Table } from "react-bootstrap";
import myFetch from "../../../hooks/myFetch";
import { PencilSquare, Trash } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

const DeleteModal = ({ show, onYes, onNo, email }) => {
    return (
        <Modal show={show} size="md" aria-labelledby="contained-modal-title-vcenter" centered>
            <Modal.Header closeButton>
                <Modal.Title id="contained-modal-title-vcenter">Delete {email} account</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>Are you sure you want to delete {email} account?</p>
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
};

const Users = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedUsers = useSelector(state => state.users);
    const [{ users, loading, error }, setState] = useState({});
    const dispatch = useDispatch();
    const [modal, setModal] = useState({ show: false, id: 0 });

    useEffect(() => {
        if (cachedUsers.users && cachedUsers.users.length > 0) {
            setState({ users: cachedUsers.users, loading: false, error: null });
        }
        setState({ loading: true, error: null });
        return myFetch(
            `/api/quiz/users`,
            "GET",
            cachedUser.token,
            undefined,
            data => {
                dispatch({ type: "USERS_SET", users: data });
                setState({ users: data, loading: false, error: null });
            },
            res => {
                setState({ loading: false, error: res });
            },
            msg => {
                setState({ loading: false, error: msg });
            }
        );
    }, []);

    const onModalYes = () => {
        myFetch(
            `/api/quiz/users/${modal.id}`,
            "DELETE",
            cachedUser.token,
            undefined,
            () => {
                const newUsers = users.filter(user => user.id !== modal.id);
                dispatch({ type: "USERS_SET", users: newUsers });
                setState({ users: newUsers, loading: false, error: null });
            },
            res => {
                console.log(res);
            }
        );
        setModal({ show: false });
    };

    return (
        <Container className="content px-3">
            <h1 style={{ marginBottom: "50px" }}>Users</h1>
            {error && <div>{error}</div>}
            {loading && <div>Loading...</div>}
            {users && (
                <Table striped bordered hover>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Email</th>
                            <th>Username</th>
                            <th>Roles</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(user => (
                            <tr key={user.id}>
                                <td>{user.id}</td>
                                <td>{user.email}</td>
                                <td>{user.username}</td>
                                <td>{user.roles_names}</td>
                                <td>
                                    <Row className="g-3">
                                        <Col xs={"auto"}>
                                            <Button variant="primary" className="p-1 icon-button d-flex align-items-center justify-content-center" as={Link} to={`/quiz/users/${user.id}/edit`} state={{ user }}>
                                                <PencilSquare size={16} />
                                            </Button>
                                        </Col>
                                        <Col xs={"auto"}>
                                            <Button variant="danger" className="p-1 icon-button d-flex align-items-center justify-content-center" onClick={() => setModal({ show: true, id: user.id, email: user.email })}>
                                                <Trash size={16} />
                                            </Button>
                                        </Col>
                                    </Row>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            <DeleteModal email={modal.email} show={modal.show} onYes={onModalYes} onNo={() => setModal({ show: false })} />
        </Container>
    );
};

export default Users;
