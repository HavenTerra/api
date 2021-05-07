'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class user extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  };
  user.init({
    username: DataTypes.STRING,
    wallet: DataTypes.STRING,
    seed: DataTypes.STRING,
    deposited: DataTypes.FLOAT
  }, {
    sequelize,
    modelName: 'user',
  });
  return user;
};