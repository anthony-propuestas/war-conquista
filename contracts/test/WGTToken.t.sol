// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WGTToken.sol";

contract WGTTokenTest is Test {
    WGTToken token;
    address admin = address(1);
    address minter = address(2);
    address player = address(3);

    function setUp() public {
        token = new WGTToken(admin);
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), minter);
        vm.stopPrank();
    }

    function test_MintByMinter() public {
        vm.prank(minter);
        token.mint(player, 1e18);
        assertEq(token.balanceOf(player), 1e18);
    }

    function test_MintRevertIfNotMinter() public {
        vm.prank(player);
        vm.expectRevert();
        token.mint(player, 1e18);
    }

    function test_BurnFrom() public {
        vm.prank(minter);
        token.mint(player, 5e18);

        vm.prank(player);
        token.approve(address(this), 2e18);
        token.burnFrom(player, 2e18);

        assertEq(token.balanceOf(player), 3e18);
    }

    function test_TransferableByPlayer() public {
        vm.prank(minter);
        token.mint(player, 3e18);

        vm.prank(player);
        token.transfer(address(4), 1e18);

        assertEq(token.balanceOf(player), 2e18);
        assertEq(token.balanceOf(address(4)), 1e18);
    }
}
