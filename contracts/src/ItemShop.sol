// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./WGTToken.sol";

contract ItemShop is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    WGTToken public immutable wgt;

    struct ShopItem {
        uint256 wgtPrice; // en wei (1 WGT = 1e18)
        uint256 quantity; // unidades entregadas en D1
        bool active;
    }

    mapping(uint256 => ShopItem) public items;

    event ItemPurchased(
        address indexed buyer,
        uint256 indexed itemId,
        uint256 quantity,
        uint256 timestamp
    );

    constructor(address wgtAddress, address admin) {
        wgt = WGTToken(wgtAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function buyItem(uint256 itemId) external {
        ShopItem memory item = items[itemId];
        require(item.active, "Item no disponible");
        require(item.wgtPrice > 0, "Item no configurado");

        wgt.burnFrom(msg.sender, item.wgtPrice);

        emit ItemPurchased(msg.sender, itemId, item.quantity, block.timestamp);
    }

    function addItem(uint256 itemId, uint256 wgtPrice, uint256 quantity) external onlyRole(ADMIN_ROLE) {
        require(!items[itemId].active, "Item ya existe");
        items[itemId] = ShopItem(wgtPrice, quantity, true);
    }

    function updateItem(uint256 itemId, uint256 wgtPrice, uint256 quantity) external onlyRole(ADMIN_ROLE) {
        items[itemId].wgtPrice = wgtPrice;
        items[itemId].quantity = quantity;
    }

    function setItemActive(uint256 itemId, bool active) external onlyRole(ADMIN_ROLE) {
        items[itemId].active = active;
    }
}
