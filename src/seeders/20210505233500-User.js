'use strict';

'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const usersArray = [];

    usersArray.push({
      username: "main",
      wallet: "terra14r9zl9n7ef7ahk49j5s68ngen6rwva9mcy70ek",
      seed: "craft city sick alone police skin notable like west romance salon breeze easy coffee paper trigger arrange must brain yellow medal afraid urge canyonn",
      deposited: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return queryInterface.bulkInsert('users', usersArray);
  },

  down: async (queryInterface, Sequelize) => {
    /**
     * Add commands to revert seed here.
     *
     * Example:
     * await queryInterface.bulkDelete('People', null, {});
     */
  }
};
