import React from 'react';

interface TaskCardProps {
    id: string;
    title: string;
    status: string;
}

export const TaskCard: React.FC<TaskCardProps> = ({ id, title, status }) => {
    return (
        <div className="task-card" data-testid={`task-card-${id}`}>
            <b>{title}</b>
            <span>{status}</span>
        </div>
    );
};
