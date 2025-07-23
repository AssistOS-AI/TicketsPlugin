const constants = require("../utils/constants.js");

async function TicketsPlugin() {
    let self = {};
    const persistence = await $$.loadPlugin("StandardPersistence");
    await persistence.configureTypes({
        ticket: {
            email: "string",
            subject: "string",
            message: "string",
            status: "string",
            resolutionMessage: "string",
            timeCreated: "string",
        }
    });
    await persistence.createIndex("ticket", "id");
    await persistence.createGrouping("tickets", "ticket", "status");
    await persistence.createGrouping("userTickets", "ticket", "email");

    const EmailPlugin = await $$.loadPlugin("EmailPlugin");
    self.adminPlugin = await $$.loadPlugin("AdminPlugin");

    self.createTicket = async function (email, subject, message) {
        await persistence.createTicket({
            email: email,
            subject: subject,
            message: message,
            status: constants.TICKET_STATUS.PENDING,
            timeCreated: new Date().getTime()
        });
    }
    self.resolveTicket = async function (id, resolutionMessage) {
        let ticket = await persistence.getTicket(id);
        if (!ticket) {
            throw new Error("Ticket not found");
        }
        ticket.status = constants.TICKET_STATUS.CLOSED;
        ticket.resolutionMessage = resolutionMessage;
        if (!ticket.timeCreated) {
            ticket.timeCreated = new Date().getTime();
        }
        await persistence.updateTicket(id, ticket);
        try {
            await EmailPlugin.sendEmail(null, // no userId for system emails
                ticket.email, process.env.APP_SENDER_EMAIL, `Support ticket ${id} response`, `Response for ticket ${id}: ${resolutionMessage}`, `<b>Response for ticket ${id}:</b> ${resolutionMessage}`);
        } catch (e) {
            console.error(`Failed to send email to ${ticket.email}: ${e.message}`);
        }
    }
    self.getTicketsCount = async function () {
        let tickets = await persistence.getEveryTicket();
        return tickets.length;
    }

    self.getUnresolvedTicketsCount = async function () {
        let tickets = await persistence.getTicketsByStatus(constants.TICKET_STATUS.PENDING);
        return tickets.length;
    }

    self.getTicketsByStatus = async function (status) {
        let tickets = await persistence.getTicketsObjectsByStatus(status);
        return tickets;
    }

    self.getTickets = async function (offset = 0, limit = 10) {
        let allTickets = await persistence.getEveryTicket();
        const ticketIds = allTickets.slice(offset, offset + limit);
        let ticketList = [];
        for (let ticketId of ticketIds) {
            let ticket = await persistence.getTicket(ticketId);
            ticketList.push({
                id: ticket.id,
                email: ticket.email,
                subject: ticket.subject,
                message: ticket.message,
                status: ticket.status,
                resolutionMessage: ticket.resolutionMessage || "",
                timeCreated: ticket.timeCreated || new Date().getTime()
            });
        }
        return ticketList;
    }
    self.getOwnTickets = async function (email) {
        return await persistence.getUserTicketsObjectsByEmail(email);
    }
    self.persistence = persistence;
    let tickets = await persistence.getEveryTicketObject();
    for (let ticket of tickets) {
        if (!ticket.timeCreated) {
            ticket.timeCreated = new Date().getTime();
            await persistence.updateTicket(ticket.id, ticket);
        }
    }


    self.getTicket = async function (id) {
        return await persistence.getTicket(id);
    }
    self.getPublicMethods = function () {
        return [];
    }
    return self;
}

let singletonInstance = undefined;

module.exports = {
    getInstance: async function () {
        if (!singletonInstance) {
            singletonInstance = await TicketsPlugin();
        }
        return singletonInstance;
    }, getAllow: function () {
        return async function (globalUserId, email, command, ...args) {
            let role;
            switch (command) {
                case "resolveTicket":
                case "getTickets":
                case "getTicketsCount":
                case "getUserTickets":
                case "getUnresolvedTicketsCount":
                case "getTicketsByStatus":
                    role = await singletonInstance.adminPlugin.getUserRole(email);
                    console.log("User role: ", role);
                    if (!role) {
                        return false;
                    }
                    return role === constants.ROLES.ADMIN || role === constants.ROLES.MARKETING;
                case "createTicket":
                case "getOwnTickets":
                    if (email === args[0]) {
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        }
    }, getDependencies: function () {
        return ["StandardPersistence", "AdminPlugin", "EmailPlugin"];
    }
}
